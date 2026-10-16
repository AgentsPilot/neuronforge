# Workplan: AI Model Price Review, Slice 5 ("Check provider prices": OpenAI + LiteLLM cross-check)

> **Last Updated**: 2026-10-16

**Developer:** Dev
**Requirement:** [AI_MODEL_PRICE_REVIEW_REQUIREMENT.md](/docs/requirements/AI_MODEL_PRICE_REVIEW_REQUIREMENT.md): UF-1; MP-FR-3, MP-FR-6a, MP-FR-12 as amended; SA Re-review RR-1 (fetch design), RR-2 (pending-only writes), RR-7, RR-8 (location); R-9 row 5 (per-provider status moved here by slice 4 RC-6); BQ-4 (Google and Kimi manual); slice 3 O-5 (cross-check columns), O-14 (`AI_PRICE_FETCH_RUN` deferred here), C-8 (float conversion)
**Branch:** `feature/ai-model-price-review-slice5` (worktree `neuronforge-model-pricing-s3`, off origin/main `86dd3266`)
**Date:** 2026-10-14
**Status:** Code Complete, uncommitted; awaiting SA code review (implementation notes and deviations in 11.1). SA approved the workplan 2026-10-15 with changes SC-1..SC-16 (folded in below; where an SC item and sections 3–6 differ, the SC item wins). T-0 closed 2026-10-15: BQ-A yes, BQ-B yes, migration `20261069` approved (production apply only with the user's go-ahead).

## Overview

Slice 5 adds the **"Check provider prices"** button on `/admin/system-config`. One click makes the server read OpenAI's official markdown pricing page and LiteLLM's public price list in parallel. A fixed, deterministic parser turns the OpenAI page into pending lines. LiteLLM is a second, independent reading that is shown beside each line and flags disagreements. It is never stored as a price. Lines go through the existing slice 3 schema, bounds and submit RPC as one `fetch` round, and each provider's outcome is stored on the round. The page shows a per-provider status line and then re-reads the comparison table. **Nothing live changes:** `ai_model_pricing` and `ai_model_image_pricing` are not written, and no charge changes. Anthropic is slice 10. Google and Kimi are manual entry for now (BQ-4).

## Table of Contents

1. [Analysis](#1-analysis) · 2. [Sources, verified today](#2-sources-verified-today) · 3. [Design](#3-design) · 4. [Migration question](#4-migration-question-o-1) · 5. [Files](#5-files) · 6. [Tests and CI](#6-tests-and-ci) · 7. [Security](#7-security) · 8. [Open questions for SA](#8-open-questions-for-sa) · 9. [Business questions](#9-business-questions) · 10. [Risks](#10-risks) · 11. [Task list](#11-task-list) · 12. [Manual check](#12-manual-check-user-after-deploy) · [SA Review Notes](#sa-review-notes) · [QA Testing Report](#qa-testing-report) · [Commit Info](#commit-info) · [Change History](#change-history)

---

## 1. Analysis

| Fact (read on `86dd3266`) | Consequence |
|---|---|
| `ai_price_submit_pending(p_admin_user_id, p_source_kind, p_provider_outcomes, p_lines)` accepts `source_kind 'fetch'` and stores `provider_outcomes` (jsonb object) on the round | The fetch round needs no new table |
| The RPC's INSERT names **no `cross_check_*` column**. The five columns exist (O-5), but nothing can write them. Line content is insert-only, and the transition trigger refuses any later UPDATE | The cross-check verdict, value and diff cannot reach their columns without changing the function (section 4) |
| The RPC refuses `jsonb_array_length(p_lines)` outside 1..200 | A round where OpenAI is blocked or its layout changed (zero lines) **cannot be recorded**. That loses the "last failure" status and the 60 s refusal anchor (section 4) |
| `PENDING_LINE_FLAGS` and the table CHECK already hold `cross_check_differs`, `cross_check_unavailable`, `cross_check_not_listed`, `retiring`; `BLOCKING_FLAGS` = `large_move`, `cross_check_differs`, `retiring` | Flags need no schema change |
| `PendingLineSchema`, `lineContextFor`, `evaluatePendingLine`, `unitKeyOf` are the manual-entry path | Fetched lines reuse them unchanged (RR-1: same schema, same bounds) |
| `tokenCoverage(snapshot)` in `comparisonModel.ts` is private | Export it (read-only) so the adapter matches against the computed coverage set |
| `decimalFromNumberLiteral` (shortest round-trip, C-8) and `shiftDecimal` exist | LiteLLM floats convert with no new numeric code |
| `eventAudience.test.ts` pins 200 events: 54 bos, 62 shared, 84 agentspilot | Registering `AI_PRICE_FETCH_RUN` (shared) moves the pins to 201 and 63 |
| `chargingUntouched.guard.test.ts` reads every `lib/ai/pricing-research/*.ts` plus a list of route files | New lib files are covered automatically; the new route is added to its list |
| `priceReview.source.test.ts`: each model-pricing URL is named in exactly one file and `page.tsx` names none | The fetch URL lives in one new client helper; the page imports a component |
| `PRICE_REVIEW_NOTE` says checking provider prices automatically "comes in a later release" | Updated (T-7). `source.guard.test.ts` S-1..S-10 pin only Sync and Edit; unchanged |
| `app/api/admin/archiving/runs/route.ts` exports `maxDuration = 60` and pins it in its test | Precedent for the route's runtime exports |

**Skills applied:** `new-api-route` (requireAdmin first, Zod, Pino + correlationId, `logAndFlush`), `tenant-isolation-guard` (service-role RPC with the admin id re-checked in SQL; no caller-supplied id or URL), `business-os-schema-check` (columns read from the migration file in this worktree). `bos-llm-call-standards` does not apply: there is no AI call (RR-1, MP-NFR-7 N/A). No entitlements import.

---

## 2. Sources, verified today

Fetched 2026-10-14 from a plain server-side client with an honest User-Agent. Copies are in the session scratchpad. Trimmed fixtures are cut from them at T-2.

**OpenAI.** Fetch `https://developers.openai.com/api/docs/pricing.md`; store `https://developers.openai.com/api/docs/pricing` as `source_url` (on the allow-list).
- The fetch returned 200, `text/markdown; charset=utf-8`, 23,231 bytes and 632 lines, with no redirect and no backslash anywhere.
- **Text table.** The heading `### Standard pricing data` appears exactly once, preceded by "Prices per 1M tokens." and "Standard". Its header row is `| Model | Short context input | Short context cached input | Short context cache writes | Short context output | Long context input | Long context cached input | Long context cache writes | Long context output |`. Cells read `$0.15`, `$0.075`, or `-` when absent. Some model cells carry a note, for example `gpt-5.4 (<272K context length)`.
- Batch, Flex, Fast and Ultrafast are separate headings with the same columns. `gpt-4o-mini` appears in Standard ($0.15 / $0.075 / $0.60), Batch ($0.075 / - / $0.30), Fast ($0.25 / $0.125 / $1.00), and in fine-tuning tables as dated ids.
- **Embeddings.** The text line "Specialized models", then "Prices per 1M tokens.", then "Standard", then `### Grouped Pricing Table data`, then the header `| Category | Model | Input | Cached input | Output |`. Its rows are `| Embedding | text-embedding-3-small | $0.02 | - | - |`. A second table with the same header follows under "Fast". The heading "Grouped Pricing Table data" itself appears 9 times, so it is not an anchor on its own.
- **Images.** The page gives image models per-token prices only. The image-generation guide (`…/guides/image-generation.md`, 113,597 bytes) gives `gpt-image-2.5-*` costs only through a JSX calculator (`<GptImageTokenCalculator …/>`). The legacy per-image table is JSX `<table>` markup keyed by display name ("GPT Image 2") with `rowSpan`. **Neither is a deterministic markdown table, so image lines stay manual entry in slice 5** (RR-1 "otherwise image lines go to manual entry"). The status line says so.
- **Generic name rule conflict (O-2).** RR-1's rule turns dots into hyphens, but OpenAI ids contain dots (`gpt-4.1`, `gpt-5.4`). Under that rule they would never match.
- **Predicted outcome against today's OpenAI coverage.** `gpt-4-turbo` and `gpt-4` are not on the page as bare ids (only `gpt-4-turbo-2024-04-09` and `gpt-4-0613`), so they read "not found on provider page". The text and embedding models in the fallback list do appear.

**LiteLLM.** Pinned URL: `https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json`.
- The fetch returned 200, `text/plain; charset=utf-8`, 2,828,373 bytes, `Cache-Control: max-age=300`, and 4,116 top-level keys; the first key is `sample_spec`, a documentation entry.
- Entries are keyed by bare id with `litellm_provider: "openai"`. Examples: `gpt-4o-mini` reads `input_cost_per_token 1.5e-7`, `cache_read_input_token_cost 7.5e-8`, `output_cost_per_token 6e-7`, and `source` set to the OpenAI pricing page. `text-embedding-3-small` reads `2e-8` / output `0`.
- `deprecation_date` is set to `2026-10-23` on `gpt-image-1`, `gpt-4.1-nano`, `o4-mini`, `gpt-4-turbo`, `gpt-4` and `gpt-3.5-turbo`, and to `2027-04-01` on `gpt-5.4-nano` and `gpt-5.1`.
- Other keys for the same model carry another provider's prefix (`azure/…`, `fal_ai/…`) or quality and size (`azure/high/1024-x-1024/gpt-image-1`). Only the bare key with a matching `litellm_provider` is read.

---

## 3. Design

### 3.1 Code layout (RR-8: `lib/ai/pricing-research/`)

| Module | Pure? | Does |
|---|---|---|
| `fetchSources.ts` | No (I/O, injectable `fetchImpl`, `now`) | `PRICE_SOURCES` config: two pinned `https` URLs plus a User-Agent constant. `fetchLimited(source)` uses a 10 s `AbortController`, `redirect: 'manual'`, `cache: 'no-store'`, and reads the stream counting bytes, aborting at the cap (5 MB markdown, 8 MB LiteLLM). It retries once on a network error or 5xx, never on 4xx or a timeout, and returns `{ outcome, status, bytes, durationMs, text? }`. The only `fetch(` call in the folder |
| `openaiPricingAdapter.ts` | Yes | Page text in, `{ outcome, lines, needsManual, notFound }` out (3.2) |
| `litellmCrossCheck.ts` | Yes | JSON text in; per line, a verdict, value text, diff and flags (3.3) |
| `fetchRound.ts` | Yes (given the fetched texts and snapshot) | Assembles the round: schema-parses each line, runs `lineContextFor` and `evaluatePendingLine`, merges cross-check flags, drops refused lines into `problems`, and builds `provider_outcomes` |
| `fetchOutcomes.ts` | Yes | Zod schema and types for `provider_outcomes`. It is used to write the outcomes and to read them back for the status line |

`PROVIDER_FETCH_MODE`: `openai: 'adapter'`; `anthropic`, `google` and `kimi` are `'manual'` (a typed record over `PRICE_PROVIDERS`, so a new provider must be classified).

### 3.2 OpenAI adapter (deterministic, no LLM)

**Pinned anchors.** Any one missing gives `layout_changed` with **zero lines** for OpenAI (O-4):
- A1: the exact heading line `### Standard pricing data`, exactly once.
- A2: the first table after A1 has the exact header row above. Columns are read **by name**: `Model`, `Short context input`, `Short context cached input`, `Short context output`. Long-context and cache-write columns are ignored (batch and long-context are flags-only per R-1, and no Business OS call reaches them).
- A3: the unit text "Prices per 1M tokens." within the 10 non-blank lines above A1.
- A4: the line "Specialized models", then within 6 non-blank lines "Standard", then a table whose header row is exactly `| Category | Model | Input | Cached input | Output |`. Only that first table is read; the "Fast" table after it is not.
- Only these two tables are read. Batch, Flex, Fast, Ultrafast, realtime, image, transcription and fine-tuning tables are never read.

**Cells.**
- A price cell must match `^[$][0-9]{1,6}([.][0-9]{1,9})?$` in full (code regex). The `$` is dropped and the digits are kept **as written** (`$0.60` gives `"0.60"`). No float at any step.
- `-` means absent:
  - for cached input, the field is omitted;
  - for output on an input-only model (`isInputOnlyPricedModel`, already a read export), it becomes `"0"`;
  - anywhere else, the model goes to **needs manual entry**.
- Any other cell text (two prices, "Free", "/ 1M characters", a comma, a range) also sends the model to needs manual entry, with the cell text cut to 80 characters. The adapter never takes the first number it finds.

**Model matching (generic, no per-model table; O-2).**
- Normalise the model cell: trim, lowercase, drop one trailing parenthetical note, collapse spaces to hyphens.
- Candidates: the normalised text, and the same text with dots turned into hyphens.
- A row is kept only when exactly one candidate equals a coverage id (`tokenCoverage(snapshot)`, provider `openai`). Rows outside coverage are ignored (RR-1).
- The same coverage id twice across A2 and A4 means needs manual ("listed twice").
- A coverage model with neither gives **not found on provider page**.

**Output.** One token line per matched model, with `source_url` set to the human page, `checked_on` set to today (UTC), and `kind: 'token'`. No image lines (section 2).

### 3.3 LiteLLM cross-check (MP-FR-6a, never blocks)

- **Parse and validate.** `JSON.parse` the text. The top level must be an object with at least 100 keys; otherwise the outcome is `layout_changed` and every line reads `unavailable`. Only the needed keys are Zod-checked: `litellm_provider` string; `input_cost_per_token`, `output_cost_per_token` and `cache_read_input_token_cost` optional, finite and ≥ 0; `deprecation_date` optional `YYYY-MM-DD`. An entry that fails the check reads `unavailable` for that line.
- **Lookup.** Use the bare key equal to the model id, with `litellm_provider === provider`. Anything else is `not_listed`, which adds the flag `cross_check_not_listed`.
- **Conversion.** `decimalFromNumberLiteral` (C-8), then `shiftDecimal(+6)` to per 1M. Each unit is compared with `gapBasisPoints` and `compareDecimals`.
- **Verdict** (O-3):
  - `agrees` when every compared unit is within 1 basis point;
  - `differs` otherwise, with `cross_check_diff_pct` set to the largest absolute gap (2 decimals);
  - the flag `cross_check_differs` is added only when a unit is more than 5% off.
- **Unavailable.** A failed fetch gives `unavailable` on every line, with the flag `cross_check_unavailable` (informational).
- **Retiring.** A `deprecation_date` gives the flag `retiring`, and the date goes into the value text (O-11).
- **What is stored.** `cross_check_value` holds text only ("LiteLLM: input 0.15, cached 0.075, output 0.6 per 1M; deprecation 2026-10-23"). `cross_check_source` is the pinned URL, and `cross_check_fetched_at` is the fetch time. A LiteLLM number is never a price.

### 3.4 Route: `POST /api/admin/model-pricing/fetch-runs` (+ `GET`)

**Why this name.** It is a plural resource noun, like the sibling `manual-entries`: each POST creates one fetch run (a `source_kind 'fetch'` round), and GET reads the recent runs for the status line. The name says the route fetches, which `proposals` would hide.

**POST**
1. Set `runtime = 'nodejs'`, `dynamic = 'force-dynamic'` and `maxDuration = 60`.
2. Take a `correlationId` and create `createLogger({ module: 'ModelPriceFetch' }).child(...)`.
3. **`requireAdmin` is the first statement.**
4. Validate the body: `z.object({}).strict()`. An empty or absent body counts as `{}`; any key gives 400. This proves no URL or provider can be supplied.
5. **60 s refusal.** `latestFetchRound()`. If `now - created_at < 60 s`, answer 409 `too_soon` with `retryAfterSeconds` and a `Retry-After` header.
6. Run `Promise.all([loadPricingSnapshot(), Promise.allSettled([fetchLimited(openai), fetchLimited(litellm)])])`. The handler is designed to finish within 30 s.
7. Adapter, cross-check, then `fetchRound`. Lines refused by the bounds are not stored; they are listed per model (O-5).
8. `submitPending({ sourceKind: 'fetch', providerOutcomes, lines })`. With zero lines this works only with the section 4 migration. Errors map as in manual entry: 23505 gives 409 `conflict`, 42501 gives 403 `not_admin_row`, anything else 500.
9. Audit `AI_PRICE_FETCH_RUN` with `logAndFlush`: `entityType 'ai_pricing'`, entity id = round id, `entity_kind: 'price_proposal'`. The details carry the per-provider outcome, line counts, needs-manual and not-found counts, the cross-check counts and the `correlationId`. No page text.
10. Pino: one line per source (`provider`, `outcome`, `durationMs`, `bytes`, `linesParsed`). Failures log at warn with the reason code. The body is never logged.
11. Answer 200 with `{ roundId, providers: { openai: {...}, anthropic|google|kimi: { outcome: 'manual_only' } }, crossCheck: {...} }`. A provider failure is still a 200: the round itself succeeded.

**GET.** `requireAdmin` first, and no query (400 if one is given). It returns, per provider, the last run's outcome and time, plus the last `ok` time. Repository reads: `latestFetchRound()` and `latestFetchRoundWithOutcome('openai', 'ok')`, a PostgREST JSON-path filter on `provider_outcomes`. Stored outcomes are re-parsed with `fetchOutcomes` Zod; anything unreadable reads "unknown". No audit (a read).

**`provider_outcomes` shape** (Zod, bounded):
- `openai`: outcome (`ok` | `http_<status>` | `timeout` | `blocked` | `layout_changed` | `too_large`), `fetched_at`, `duration_ms`, `bytes`, `lines_stored`, plus `needs_manual` / `not_found` / `refused` lists (≤ 50 each; model id and reason; cell text ≤ 80 characters);
- `anthropic`, `google` and `kimi`: `manual_only`;
- `litellm`: outcome, `fetched_at`, and the agrees / differs / not_listed / unavailable counts.

`blocked` means a 403, or a `.md` URL that answered `text/html` (a challenge page). 429 is `http_429` and is not retried (O-9).

### 3.5 Repository (`AiPriceProposalRepository`, additive)

- `latestFetchRound()` and `latestFetchRoundWithOutcome(provider, outcome)`: select `id, created_at, created_by, provider_outcomes` where `source_kind = 'fetch'`, newest first, limit 1.
- `PENDING_LINE_COLUMNS` adds `cross_check_value, cross_check_diff_pct, cross_check_source, cross_check_fetched_at`.
- `submitPending` keeps its signature. `AiPriceSubmitLine` gains five optional `cross_check_*` fields, and the result rows may carry a null line id for a zero-line round.
- Still no update or delete method. Platform reference data, so there is no `user_id` (header note unchanged).

### 3.6 UI (`/admin/system-config`)

- **`components/ProviderPriceCheck.tsx`** (client): a "Check provider prices" button.
  - While the run is in progress: `disabled`, `aria-busy`, label "Checking provider prices…".
  - Below it, a `role="status"` region with one line per provider:
    - OpenAI fetched: "OpenAI: 24 prices read <time>; 2 need manual entry; 2 not on the page";
    - blocked: "OpenAI: the provider blocked the check at <time>. Enter prices by hand.";
    - layout changed: "OpenAI: the pricing page layout changed at <time>. No prices were read. Enter prices by hand.";
    - a timeout or an HTTP error in words.
  - Each line adds "Last successful check: <time>" when one exists.
  - Anthropic, Google and Kimi: "manual entry for now".
  - Cross-check: "LiteLLM cross-check: 20 agree, 2 differ, 1 not listed", or "unavailable; prices still loaded".
  - Images: "Image prices: manual entry (OpenAI publishes them only in a calculator)".
  - A 409 shows "Prices were checked less than a minute ago. Try again in N s." in the alert box.
- **`priceFetchRun.ts`** (client helper; the only file naming `/api/admin/model-pricing/fetch-runs`): `runPriceFetch()` and `readFetchStatus()` through `readAdminResponse`, using `clientLogger`.
- **`page.tsx`**: render the component in the pricing toolbar beside "Enter provider price". `onFinished` calls `fetchData(true)`, the existing silent re-read, so the table refreshes.
- **`PriceRowCells`**: the source cell shows the new `crossCheckDetail` words (O-12), for example "Cross-check: agrees (LiteLLM, 2026-10-14)" or "differs by 7.50%".
- **`PRICE_REVIEW_NOTE`** becomes: "Nothing in the provider column is charged yet. Check provider prices reads OpenAI's official pricing page; Anthropic, Google and Kimi prices are entered by hand for now. Applying a new price and each model's price history come in later releases. Until then, Sync and Edit still change live prices directly."
- Strings go in `priceReviewCopy.ts`. No number parsing in browser files (RC-8). Chips only from `StatusChip`.

---

## 4. Migration question (O-1)

**Ruled A by SA (O-1), approved by the user 2026-10-15.** Number `20261069`, re-checked free on 2026-10-15 (no worktree, no ref). Files and shape per SC-1..SC-5a: `supabase/migrations/20261069_ai_price_submit_pending_fetch_rounds.sql`, rollback in `supabase/SQL Scripts/`, checker and probe in `scripts/`, test `supabase/migrations/__tests__/ai-model-pricing-slice5.migration.test.ts`. Apply before the code deploys (SC-7); roll back only after reverting the deploy (SC-5a).

**Target was none. Finding: two real gaps (section 1) need the submit function changed.** The tables are unchanged.

| | **A. Function-only migration (recommended)** | **B. No migration** |
|---|---|---|
| Change | `2026106x_ai_price_submit_pending_fetch.sql` (next free number at T-1; `20261069` today). `CREATE OR REPLACE` with the **same signature**. (1) The INSERT also takes `cross_check_verdict`, `_value`, `_source`, `_fetched_at` and `_diff_pct` from the line JSON. (2) `p_source_kind = 'fetch'` may carry **0..200** lines; a zero-line round returns one row with the round id and null line fields. Grants re-stated: `REVOKE ALL` from PUBLIC, anon and authenticated; `EXECUTE` to `service_role`. The function still never names the live tables | The verdict is kept only as flags (agrees = no cross-check flag on a fetch line). Per-line LiteLLM values go into `provider_outcomes.litellm.lines`. A zero-line round is not stored: "last failure" and the 60 s anchor come from the audit trail (a new read of `audit_trail` for business state), or from per-instance memory |
| Cost | One small migration the user applies by hand; a rollback (the slice 3 body verbatim); a read-only checker; a migration source test | Columns designed in slice 3 stay NULL forever. A blocked or changed page leaves no round, so RR-1 monitoring ("last failure reason per provider") is weaker |
| Order | Apply the migration **before** the code deploys. The new body is a superset: today's manual-entry code sends no `cross_check_*` keys, so they stay NULL, and it always sends ≥ 1 line | — |

Paste safety as in slice 3: no word "into" inside a string literal or `RAISE` message, and no backslash. Charging is untouched either way.

---

## 5. Files

| File | Action |
|---|---|
| `lib/ai/pricing-research/fetchSources.ts`, `openaiPricingAdapter.ts`, `litellmCrossCheck.ts`, `fetchRound.ts`, `fetchOutcomes.ts` | create |
| `lib/ai/pricing-research/__fixtures__/openai-pricing-2026-10-14.md` (trimmed: Standard, Batch and Fast text tables, Specialized Standard and Fast; about 60 lines), `litellm-prices-2026-10-14.json` (about 12 entries incl. `sample_spec`, an `azure/` key and a deprecated entry) | create |
| `lib/ai/pricing-research/comparisonModel.ts` | modify: export `tokenCoverage`; `PendingView.crossCheckDetail` (additive) |
| `lib/repositories/AiPriceProposalRepository.ts`, `lib/repositories/types.ts` | modify (3.5) |
| `app/api/admin/model-pricing/fetch-runs/route.ts` + `__tests__/route.test.ts` | create |
| `lib/audit/events.ts`, `lib/audit/eventAudience.ts`, `lib/audit/__tests__/eventAudience.test.ts` | modify: `AI_PRICE_FETCH_RUN` (info, SOC2, `shared`); pins 201 / 63, with a comment line |
| `app/admin/system-config/components/ProviderPriceCheck.tsx`, `priceFetchRun.ts` | create |
| `app/admin/system-config/page.tsx`, `priceReviewCopy.ts`, `components/PriceRowCells.tsx` | modify (3.6) |
| `supabase/migrations/20261069_ai_price_submit_pending_fetch_rounds.sql`, `supabase/SQL Scripts/20261069_ai_price_submit_pending_fetch_rounds_rollback.sql`, `scripts/check-ai-price-submit-pending-fetch-migration.sql`, `scripts/probe-ai-price-submit-pending-fetch-migration.sql`, `supabase/migrations/__tests__/ai-model-pricing-slice5.migration.test.ts` (+ a small shared SQL-reading helper) | create (SC-1..SC-5a) |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | modify: rows for `model-pricing/fetch-runs` POST and GET |
| `docs/requirements/AI_MODEL_PRICE_REVIEW_REQUIREMENT.md` | modify: status and Change History |

---

## 6. Tests and CI

**All offline: no network in CI, and no new job.** Pure parser and cross-check suites run in milliseconds; total added time is well under 1 s inside the existing Jest job.

| Suite | Cases |
|---|---|
| `openaiPricingAdapter.test.ts` | Happy fixture: `gpt-4o-mini` gives `0.15` / `0.075` / `0.60` from **Standard**, never the Batch `0.075` / `0.30` (negative control). `gpt-5.4 (<272K context length)` matches `gpt-5.4`. `gpt-4.1` matches (dots kept). An embedding gives output `"0"`. Missing model gives not found. Two-price cell, "Free" and "/ 1M characters" give needs manual. `-` output on a chat model gives needs manual. A model listed twice gives needs manual. Variants built by string replace: renamed heading, renamed column, missing unit line, and the Specialized anchor missing each give `layout_changed` with 0 lines. Rows outside coverage are ignored. No float: every price equals the cell text minus `$` |
| `litellmCrossCheck.test.ts` | Agrees (`7.5e-8` gives `0.075`); differs at 3% (no flag); differs at 7% (`cross_check_differs`); `not_listed` (absent; `azure/` key only; provider mismatch); `unavailable` (fetch failed; under 100 keys; bad entry); `deprecation_date` gives `retiring`; value text contains no float form |
| `fetchSources.test.ts` (injected fetch) | Timeout gives `timeout`, no retry. 503 then 200 gives `ok` (one retry). 404 gives `http_404` (no retry). 403 gives `blocked`. HTML body for `.md` gives `blocked`. A 301 gives `http_301` (not followed). A body over the cap gives `too_large` (stream aborted). A network error is retried once. The User-Agent header is sent |
| `fetchRound.test.ts` | Bounds-refused line dropped into `refused`, the others kept; flags merged from the bounds and the cross-check; `provider_outcomes` passes its own Zod; the lists are capped |
| `route.test.ts` (fetch-runs) | 401; 403 (not admin); 403 `not_admin_row` (42501); 400 (a body with `url`); **409** (last round 30 s ago, with `Retry-After`); **partial failure**: OpenAI blocked plus LiteLLM ok gives 200, zero lines, outcomes stored; LiteLLM down: lines carry `unavailable`; **happy path**: RPC called once with `'fetch'`, lines and outcomes, `logAndFlush` with `AI_PRICE_FETCH_RUN`, summary returned; GET status. Exports: POST and GET, `maxDuration` 60, `runtime` `nodejs`; `requireAdmin` first statement |
| `fetchSources.source.test.ts` (source guard) | **No LLM in `lib/ai/pricing-research` or the route**: no import of `providerFactory`, `@/lib/ai/providers`, `openai`, `@anthropic-ai/sdk`, `groq-sdk` or the BOS LLM runner. `fetch(` appears only in `fetchSources.ts`; the only URLs are the two pinned constants; no logger call names the body text variable; fixtures contain no backslash |
| `providerPriceCheck.render.test.tsx` | Button busy and disabled while the run is in progress; each outcome line in words; last success time; manual-only providers; 409 message in the alert; `onFinished` triggers the re-read; the cross-check line |
| Existing | `eventAudience` pins; `chargingUntouched.guard` list gains the route; `priceReview.source.test` file list gains the two new client files; slice 3 migration test unchanged (or extended if A) |

Commands: `npx jest lib/ai/pricing-research app/api/admin/model-pricing app/admin/system-config lib/audit`, `npx tsc --noEmit`, `npm run lint`.

---

## 7. Security

- **No SSRF.** The two URLs are code constants; the body schema is an empty strict object. Redirects are not followed (`redirect: 'manual'`), so the host cannot change.
- **Caps and timeouts.** 5 MB and 8 MB caps enforced while streaming, a 10 s timeout per attempt, at most one retry.
- **Secrets and logging.** No secrets and no keys. No page body is logged or audited, and the bounded cell snippets go only to the admin response and `provider_outcomes`.
- **Writes.** Pending-only, through the service-role RPC, which re-checks `admin_users`; the live tables are never named (pinned).
- **Admin route.** `requireAdmin` first, so the admin-authz CI guard covers it automatically.

---

## 8. Open questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| O-1 | Migration A or B (section 4)? | **A**: a function-only change, applied before the deploy |
| O-2 | RR-1's name rule turns dots into hyphens, but OpenAI ids contain dots. Is the two-candidate rule acceptable: as written, or dots to hyphens, with exactly one coverage match? | Yes. It stays generic and is ready for Anthropic display names in slice 10 |
| O-3 | Cross-check verdict: agrees within 1 bp; differs otherwise; flag only above 5%? | Yes |
| O-4 | If the embeddings anchor (A4) is missing, does all of OpenAI fail with `layout_changed`, even though the Standard table is fine? | Yes, strict: fail loudly, as RR-1 says |
| O-5 | A fetched line refused by the bounds is dropped and listed, and the rest is stored. Manual entry refuses the whole request instead | Yes: RR-1 "line not stored, shown as a problem" |
| O-6 | A fetched line supersedes a pending **manual** line for the same unit (the existing RPC rule) | Yes; see BQ-A |
| O-7 | No retry on a timeout (keeps the worst case at about 20 s); redirects reported as `http_3xx`, never followed | Yes |
| O-8 | The 60 s refusal is checked in the route only. A double click during an in-progress run creates two rounds, and the second supersedes the first (harmless, both audited). The button is disabled while busy | Accept; no SQL lock |
| O-9 | `blocked` covers 403 and an HTML answer to a `.md` URL; 429 is `http_429`, with no retry | Yes |
| O-10 | Image lines are manual in slice 5 (section 2) | Yes; revisit if OpenAI publishes a markdown table |
| O-11 | Any LiteLLM `deprecation_date`, past or future, gives `retiring` (blocking at apply) | Yes; the date is shown in words |
| O-12 | `PendingView.crossCheckDetail` is a new field, and `crossCheck` is unchanged (no existing test edits) | Yes |
| O-13 | Status via `GET` on `fetch-runs`, not a new field in the comparison response | Yes: one resource, one file per URL |

---

## 9. Business questions

| # | Question | Recommendation |
|---|---|---|
| BQ-A | If someone typed in a price by hand and later presses "Check provider prices", the newer official reading replaces the hand-typed **pending** price for that model. Nothing live changes, and both stay in the record. Is that what you want? | Yes: the newest official reading wins. **Decided by the user 2026-10-15: YES** |
| BQ-B | OpenAI publishes per-image prices only through an on-page calculator, so image prices (including `gpt-image-2.5-flare`) stay **manual entry**. Acceptable? | Yes. Images are entered by hand, with the guide as the source. **Decided by the user 2026-10-15: YES** |

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| OpenAI changes the page layout | Anchors fail loudly with zero lines; the status line and a Pino warn say so; manual entry still works |
| The parser reads the wrong table or column | Standard-only anchors and named columns; the Batch negative control; the LiteLLM cross-check flags anything over 5% and blocks it at apply |
| LiteLLM lags the provider | It is a cross-check only; a "differs" line needs an override reason, and the admin can open both sources |
| Bot protection (403 or a challenge page) | Classified as `blocked`; no evasion; manual entry |
| Function time | A 30 s design budget under `maxDuration` 60; parallel fetches; a 2.8 MB JSON parse takes tens of ms |
| The migration (if A) touches a money-path function | Same signature, a superset, the live tables still not named (pinned); rollback and checker; the user applies it |
| Upstream size growth (LiteLLM 2.8 MB today) | 8 MB cap gives `too_large`, and the cross-check reads `unavailable` |

---

## 11. Task list

- [x] T-0 SA rules on O-1..O-13 (SC-1..SC-16); the user answers BQ-A and BQ-B (both YES) and approves migration `20261069` (2026-10-15)
- [x] T-1 Migration `20261069`, rollback, checker, probe, slice 5 migration test (SC-1..SC-6)
- [x] T-2 Fixtures trimmed from the 2026-10-14 captures; `fetchOutcomes.ts`
- [x] T-3 `openaiPricingAdapter.ts` and its tests
- [x] T-4 `litellmCrossCheck.ts` and its tests; `fetchSources.ts` and its tests; `fetchRound.ts` and its tests
- [x] T-5 Repository additions, types, `tokenCoverage` export, `crossCheckDetail`
- [x] T-6 Route POST and GET, audit registration and pins, route tests, the guard list
- [x] T-7 `ProviderPriceCheck.tsx`, `priceFetchRun.ts`, page wiring, copy, render tests, source-test list
- [x] T-8 No-LLM source guard; commands green; the slice 3 migration test unedited (SC-4); charging files, `source.guard` and `chargingUntouched.guard` assertions unedited; `git diff --stat` reviewed
- [x] T-9 Docs: the admin access rows, the requirement status and Change History, this workplan

### 11.1 Implementation notes and deviations (2026-10-15)

Code complete, uncommitted. `20261069` re-checked free at T-1 (no file in any worktree or ref); **re-check before the PR** (SC-1).

| # | Deviation or note | Why |
|---|---|---|
| D-1 | `chargingUntouched.guard.test.ts` is **not** edited (SC-16 asked for the route in its `SLICE_FILES`) | TL hard rule for this slice: that guard stays unedited. Its folder scan already covers the five new lib files; `fetchSources.source.test.ts` applies the same two rules to the route (read-only imports from `@/lib/ai/pricing`, no live-table name or write in code) |
| D-2 | Slice 4 suites edited, each with a one-line comment: `pages.render` R-1, R-5, R-9; `pages.edge.qa` E-2, E-3; `manualPriceEntry` M-6b; `priceTable` T-14 | The page now reads `fetch-runs` once when the card opens. That read races the clicks, so ordered call lists leave it out and count it separately inside `waitFor`. R-9 finds the PUT by method, because the index shifted. T-14's slice 4 pin "no Check / Fetch button" is deliberately narrowed to exactly one "Check provider prices" button. `source.guard.test.ts` is unedited |
| D-3 | `PendingView.crossCheckDetail` is optional | It is additive (O-12). Optional keeps slice 4 read-model doubles valid with no test edits. The server always sets it |
| D-4 | Shared SQL helper at `tests/helpers/sqlText.ts` | Jest collects every `.ts` under `__tests__/`, so the helper cannot live beside the test (SC-4) |
| D-5 | Repository names: `submitFetchRound`, `latestFetchRound()`, `latestFetchRoundByOutcome(source, match)` (match `ok` or `not_ok`) | §3.5 called the reads `latestFetchRoundWithOutcome`. The source is a closed union, so no caller text reaches a filter. Two plain filters (`.eq` / `.neq` on the JSON path), never `.or()` |
| D-6 | The browser checks the shape of both `fetch-runs` answers before drawing them | Same rule as `priceComparisonRead` (`rows`). Older test routers answer unknown URLs with pricing rows |
| D-7 | `fetchRound` sets the price fields from the parsed line itself | Not left to the snapshot fields. A LiteLLM value can never reach a price field |
| D-8 | The LiteLLM fixture has 112 keys, trimmed to 7 fields each, not about 12 | The real parser refuses a list under 100 keys as `layout_changed` |
| D-9 | SA optimisation 2 adopted (`name_notes` in `provider_outcomes`); optimisation 3 adopted in words ("second price list (LiteLLM)", "retirement date"); optimisation 1 not adopted (manual Zod already refuses the keys) | — |
| D-10 | Type check | A full `tsc --noEmit` runs out of heap on this machine (4 GB). The touched files were checked through one program built from them (0 diagnostics); `typecheck:bos-llm` passes |
| D-11 | Test time | In band, with this machine under load, the slowest page case is 1.56 s; the same cases without the new component took 0.8 to 1.4 s on the same run. In the parallel folder run on this loaded machine, four pre-existing page cases took 2.0 to 3.0 s |
| D-12 | One failure in a first parallel run of `priceTable.render` did not reproduce | Most likely T-14 reading the call list before the status read fired. Fixed with `waitFor` (D-2); then green in six runs |
| D-13 | **Review pass (2026-10-15) supersedes D-2:** the four slice 4 page suites now `jest.mock` `ProviderPriceCheck` with a static "Check provider prices" button | QA flake risk (E-1 at 5.8 s, T-1b at 5.1 s in loaded parallel runs). Their D-2 call-list edits are reverted to slice 4's form; only T-14 keeps its edit (exactly one Check button). The page wiring is pinned in `priceReview.source.test.ts`; the component is tested in `providerPriceCheck.render.test.tsx` |

---

## 12. Manual check (user, after deploy)

1. With the user's go-ahead, apply `20261069` **before** the code deploys; the slice 5 checker reads VERDICT PASS, and the unchanged slice 3 checker still reads PASS 68/0 (SC-5, SC-7).
2. Open `/admin/system-config` and press **Check provider prices**. The button is busy, then the status shows "OpenAI: N prices read", the LiteLLM counts, and "manual entry for now" for Anthropic, Google and Kimi.
3. The table refreshes. OpenAI rows show the new provider price with green or red chips, and the source cell shows the cross-check words.
4. Press again at once: "checked less than a minute ago".
5. No live price changed: the "In effect since" dates are unchanged.

---

## SA Review Notes

**Reviewed by SA — 2026-10-15** (against `86dd3266`, worktree `neuronforge-model-pricing-s3`; both sources re-fetched by SA on 2026-10-15 and matched section 2: OpenAI 200, `text/markdown`, 23,231 bytes, 632 lines, `### Standard pricing data` once, `Specialized models` once, `Grouped Pricing Table data` 9 times; LiteLLM 200, 2,828,373 bytes, every cost a JSON number in canonical literal form)
**Status:** ✅ Approved WITH CHANGES SC-1..SC-16 (no halt). Implementation may start once T-0 is closed: the user answers BQ-A and BQ-B, and gives the OK that a hand-applied migration (`20261069`) is part of this slice.

### Rulings on O-1..O-13

| # | Ruling |
|---|---|
| O-1 | **A**, with SC-1..SC-7. B is refused: it leaves the slice 3 cross-check columns dead, and it moves business state (the 60 s anchor, the last failure) into `audit_trail` or per-instance memory. A function-only `CREATE OR REPLACE` with the same signature is the smaller risk. Number **`20261069`** (see SC-1) |
| O-2 | Approved. It is generic and has no per-model table. Conditions in SC-10: dedupe the candidates before counting; the normalised text must pass `MODEL_ID_REGEX`; apply the coverage filter **before** any cell is judged |
| O-3 | Approved, with SC-11: every decision uses the exact `movesBeyondBasisPoints`, never the rounded `gapBasisPoints` (C-8). The basis is the official price |
| O-4 | Approved, strict. RR-1 says a missing anchor fails the provider. A4 is tightened in SC-10 |
| O-5 | Approved, as RR-1 requires. A refused line is never sent to the RPC, so it supersedes nothing |
| O-6 | Approved, subject to BQ-A. It is the existing RPC rule, unchanged |
| O-7 | Approved. Add `network_error` (SC-9) |
| O-8 | Approved: the check is in the route only and no SQL lock is added. The per-unit advisory lock already serialises concurrent rounds, so a second round supersedes the first and does not hit a 23505 |
| O-9 | Approved. It also applies to LiteLLM: an HTML answer is `blocked` |
| O-10 | Approved, subject to BQ-B |
| O-11 | Approved: any date, past or future, gives `retiring`. The rule is deterministic and reads no clock. The date comes from LiteLLM, so the words must name the second list as its source (optimisation suggestion 3) |
| O-12 | Approved |
| O-13 | Approved, with SC-12: GET must also return the last **failure** per provider, as RR-1's monitoring list requires |

### Required changes

**Migration (O-1 = A)**

- **SC-1 Number and files.** The next free number is `20261069`. `git fetch` plus `git ls-tree` over every remote branch and every local worktree shows `20261068` as the highest number. 20261063..65 are gaps; do not backfill them. The P-6a workplan (`neuronforge-invite-s1`) may also take the "next free" number if its SA picks its function option, so **re-check at T-1 and again before the PR**. Placement follows slice 3, not section 5:
  - `supabase/migrations/20261069_ai_price_submit_pending_fetch_rounds.sql`
  - `supabase/SQL Scripts/20261069_ai_price_submit_pending_fetch_rounds_rollback.sql`
  - `scripts/check-ai-price-submit-pending-fetch-migration.sql` (checker)
  - `scripts/probe-ai-price-submit-pending-fetch-migration.sql` (probe)
  - `supabase/migrations/__tests__/ai-model-pricing-slice5.migration.test.ts`
- **SC-2 The migration holds exactly these statements, in this order:**
  1. `BEGIN;`
  2. `SET LOCAL lock_timeout = '5s';`
  3. one `CREATE OR REPLACE FUNCTION public.ai_price_submit_pending(p_admin_user_id uuid, p_source_kind text, p_provider_outcomes jsonb, p_lines jsonb)`, with:
     - the slice 3 `RETURNS TABLE (out_proposal_id uuid, out_line_id uuid, out_line_index integer, out_superseded_line_id uuid)`, byte-identical;
     - `LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''`, restated. `CREATE OR REPLACE` resets any attribute it does not state, and it keeps the owner and ACL;
  4. the four `REVOKE ALL ON FUNCTION ... FROM PUBLIC|anon|authenticated|service_role`;
  5. `GRANT EXECUTE ... TO service_role`;
  6. `COMMIT;`

  It has **no** `ALTER TABLE`, no `GRANT ... ON TABLE`, no trigger or index statement, and no `DROP FUNCTION`. A drop would make fresh default grants and break any session holding the function. The slice 3 transition trigger and the C-1 column grant are therefore untouched by construction.
- **SC-3 Body changes, and nothing else.**
  - **(a) Line counts.** `manual` still needs 1..200 lines. `fetch` may carry 0..200. A zero-line `fetch` needs `p_provider_outcomes` to be a JSON object, otherwise 22023.
  - **(b) Zero-line round.** Insert the round, `RETURN NEXT` one row (the round id, then NULL, NULL, NULL), then `RETURN`.
  - **(c) Cross-check columns.** The lines INSERT adds `cross_check_verdict`, `cross_check_value`, `cross_check_source`, `cross_check_fetched_at` (`::timestamptz`) and `cross_check_diff_pct` (`::numeric`) from the line JSON.
  - **Unchanged:** the admin check, the duplicate-unit check, the advisory lock in unit-key order, the supersede, the flags array, and the pre-generated ids (no `RETURNING`).
  - **Still never named:** the live tables.
- **SC-4 Migration source test.** The slice 3 test reads only its own four files, so the new file does not break it. Leave it unedited. The new test pins:
  - **paste safety:** as SC-6;
  - **statement list:** exactly the SC-2 list;
  - **signature:** the `RETURNS TABLE` text is identical to slice 3's;
  - **function attributes:** `SECURITY INVOKER\nSET search_path = ''` appears once, and `SECURITY DEFINER` does not appear;
  - **body pins:** the slice 3 body pins (admin check, lock order, never the live tables), re-asserted against the new body;
  - **cross-check columns:** all five are in the INSERT;
  - **zero-line rule:** zero lines are allowed only on the `fetch` branch;
  - **rollback:** the rollback's `submit_pending` body equals the slice 3 body **byte for byte** after CRLF normalisation;
  - **checker:** read-only from its first statement;
  - **probe:** one DO block that always ends in an exception.

  Prefer a small shared helper module over copy-pasting `statementsOf` and `bodyOf`. Also update the workplan's T-8 "charging-file diff empty" to "the slice 3 migration test unedited".
- **SC-5 Checker** (read-only; the first line is `SET default_transaction_read_only = on;`). One row each, plus a VERDICT row:
  - the function exists (`to_regprocedure`);
  - `NOT prosecdef`;
  - `proconfig = ARRAY['search_path=""']`;
  - `pg_get_function_result` equals the slice 3 TABLE text;
  - service_role holds EXECUTE; anon and authenticated do not; no PUBLIC entry in `aclexplode(proacl)`;
  - `prosrc` contains `cross_check_verdict` and `cross_check_diff_pct` (the new body is live);
  - `prosrc` does not contain `ai_model_pricing` or `ai_model_image_pricing`.

  After the apply, the user **also re-runs the unchanged slice 3 checker**. It must still read PASS 68/0, which proves the trigger, the C-1 column grant, RLS and the policies held. Optionally add a probe (precedent: slice 3 C-11), as one DO block that ends in an exception so it writes nothing:
  - P1: a zero-line fetch returns one row with a round id and a NULL line;
  - P2: a zero-line manual entry gives 22023;
  - P3: the five cross-check values are stored exactly;
  - P4: a fetch line supersedes a pending manual line;
  - P5: `authenticated` cannot execute.
- **SC-5a Rollback.**
  - Shape: `BEGIN; SET LOCAL lock_timeout = '2s';`, then `CREATE OR REPLACE` with the **slice 3 function verbatim** (header and body), the same REVOKE and GRANT, then `COMMIT;`.
  - No guard is needed. Rows the new body wrote (zero-line rounds, cross-check values) are valid under every slice 3 constraint and stay.
  - Order: **revert the code deploy first**, then run the rollback. Otherwise a zero-line fetch gets 22023 and a 500.
- **SC-6 Paste safety** (migration, rollback, checker, probe):
  - the word "into" appears only as the keyword of the two `INSERT INTO` statements, in the migration and the rollback; it never appears in the checker or the probe, or in any literal or `RAISE` message;
  - no `--` comment and no `/*` comment;
  - no backslash;
  - ASCII only;
  - no single-letter alias (`AS x`, `FROM t x`);
  - literals are letters, digits, underscore and space, except named ones listed in the test (for example the `LIKE` patterns in the checker);
  - punctuation in literals is built with `chr()`, as in slice 3.
- **SC-7 Order and requirement record.**
  - Apply `20261069` **before** the code deploys. This is safe because it is a superset: today's manual entry sends at least 1 line and no `cross_check_*` keys, so it behaves as before.
  - The production apply needs the user's explicit OK (R-9).
  - Update R-9 row 5 in the requirement from "Mig: No" to "Yes (function-only, `20261069`)", and section 12 step 1 to match.

**Fetch, parser, cross-check**

- **SC-8 Zero-line result type.**
  - Do not widen `AiPriceSubmitResultLine` to nullable line fields silently. That ripples into `manual-entries/route.ts` (`submitLines[row.lineIndex - 1]`) under strict TS.
  - Preferred: the repository drops the row whose `out_line_id` is NULL and returns the round id separately. Use a typed result, or a thin `submitFetchRound` wrapper over the same RPC.
  - If the manual route is touched anyway, add it and its test to section 5.
- **SC-9 `fetchSources.ts` hardening.**
  - **Outcomes:**
    - add `network_error` for a connection or DNS failure that remains after the one retry;
    - `fetchLimited` **never throws**: every path returns an outcome. `allSettled` stays as a backstop, and a rejected promise maps to `network_error`.
  - **Timeout and size:**
    - the 10 s `AbortController` timer covers headers **and** the body read, and is cleared in `finally`;
    - a `content-length` above the cap gives `too_large` before reading.
  - **Content type:**
    - OpenAI accepts `text/markdown` or `text/plain`;
    - LiteLLM accepts `text/plain` or `application/json`;
    - `text/html` gives `blocked`;
    - anything else gives `layout_changed`.
  - **Request:**
    - only the `User-Agent` and `Accept` headers are sent, with no cookie or auth header;
    - the User-Agent is a named constant with the product name and version.
  - **Runtime and scope:**
    - `import 'server-only'`;
    - `PRICE_SOURCES` is exactly two entries, pinned by equality with the two literal URL strings.
- **SC-10 Parser determinism** (verified against the page on 2026-10-15).
  - **A1 and A2:** the first non-blank line after the A1 heading is the header row, and the next line is the separator. The header is compared as a **trimmed cell list**, exactly. The table ends at the first line that does not start with `|`, so it can never run into Batch.
  - **Rows:** a row whose cell count differs from the header's goes to needs manual if its model is in coverage, and is otherwise ignored.
  - **A3:** the **nearest** unit line above A1 must equal `Prices per 1M tokens.` exactly. The page also has "Prices per 1M tokens unless noted.", which must not satisfy it.
  - **A4:**
    1. `Specialized models` appears exactly once.
    2. Then the next non-blank lines are exactly `Prices per 1M tokens.`, then `Standard`, then `### Grouped Pricing Table data`.
    3. Then the header cell list.

    This makes the 9 identical headings irrelevant, and adds the unit anchor RR-1 requires (section 3.2 omitted it for A4).
  - **Coverage first:** filter by coverage **before** judging a cell, so out-of-coverage rows ("Free" on `omni-moderation-latest`) are ignored and add no noise.
  - **Matching:**
    - dedupe the two candidates;
    - a candidate must pass `MODEL_ID_REGEX`;
    - more than one coverage match means needs manual.
  - **Fixture tests:**
    - `gpt-5.4 (<272K context length)`;
    - the "unless noted" decoy above a table;
    - the Fast grouped table not read;
    - a row with a wrong cell count.
- **SC-11 Cross-check exactness (C-8).**
  - **Conversion:** per unit, `decimalFromNumberLiteral(n)` then `shiftDecimal(+6)`. Compare only units both sides have.
  - **Verdict and flag:**
    - `agrees` iff no unit `movesBeyondBasisPoints(litellm, official, 1)`;
    - the `cross_check_differs` flag iff any unit `movesBeyondBasisPoints(litellm, official, 500)`;
    - both decisions are **exact**.
  - **Displayed gap:** `cross_check_diff_pct` is the largest `|gapBasisPoints| / 100`, to 2 decimals, for display only. It is NULL when the official unit is 0. An official 0 against a non-zero LiteLLM value is `differs` and flagged; 0 against 0 agrees.
  - **No comparable unit:** an entry with no unit to compare is `not_listed`.
  - **Value text:** built only from `formatDecimal` output, never `String(number)`. A test asserts that no `e-` appears in it.
  - **Fixture test:** every cost literal in the fixture converts to exactly the decimal its JSON text spells. The known limit (more than 15 significant digits) is stated in the module header and is absorbed by the 1 bp tolerance. Today no such literal exists: SA scanned the full file.
- **SC-12 Status (RR-1 monitoring).** GET returns per provider (OpenAI and LiteLLM):
  - the last run, with its outcome and time;
  - the last `ok` time;
  - the last **non-ok** run, with its reason and time.

  That is one more `.neq` read, and no `.or()` (the PostgREST bug). The page shows "Last failure: <reason> at <time>" when one exists.
- **SC-13 Response envelope.** Use CLAUDE.md's `{ success: true, data: {...} }` for 200. The 409 is `{ success: false, error, code: 'too_soon', retryAfterSeconds }` plus the `Retry-After` header. Send the integer the client shows, so the client does no number parsing (RC-8).
- **SC-14 `provider_outcomes` and audit bounds.**
  - `fetchOutcomes` is `.strict()`:
    - model ids pass `MODEL_ID_REGEX`;
    - reasons are an enum;
    - cell text is at most 80 characters;
    - each list holds at most 50 items.
  - The audit details carry **counts and model ids only**: no cell text, no page text.
  - The client takes types only from `fetchOutcomes` (`import type`), unless it is added to `VALUE_ALLOWED` in `priceReview.source.test.ts` with a reason.

**Rule 5, tests and audit**

- **SC-15 No model literals in feature code.** The new lib, route and UI files never contain a model id. They do not import the call catalog, so `check:bos-llm-literals` does not scan them, and the guard must cover them itself. Extend `fetchSources.source.test.ts`:
  - a code-only check (comments stripped) for a quoted literal shaped like a model id (`gpt-`, `o<digit>`, `text-embedding-`, `claude-`, `gemini-`, `kimi-`) in non-test files of `lib/ai/pricing-research` and the new route;
  - fixtures and tests are exempt;
  - anchor and header strings are not model ids and stay allowed.
- **SC-16 Tests, audit registration, CI.**
  - **Offline only:** every suite installs a `global.fetch` spy that fails the test if called. Only the injected `fetchImpl` may answer.
  - **New cases:** route tests add `network_error`, a zero-line round, and the GET last failure.
  - **Audit registration:**
    - `AI_PRICE_FETCH_RUN` in `events.ts`: the constant plus config (`severity: 'info'`, `['SOC2']`, "Provider prices checked (stored as pending, not applied)");
    - `eventAudience.ts` `'shared'`;
    - pins 201 / 54 / 63 / 84, with the dated comment line.
  - **Guard list:** `chargingUntouched.guard` `SLICE_FILES` gains `fetch-runs/route.ts`.
  - **No-LLM guard:** as section 6.
  - **CI:** everything runs in the existing Jest job; no new job and no network.

### Proportionality
The scope is proportional. Five small pure modules carry the logic that needs testing, and the route stays thin. Merging `fetchOutcomes` into `fetchRound` is acceptable, but not required. The probe (SC-5) is optional; the checker is not.

### Optimisation suggestions (non-blocking)
1. Defence in depth: the RPC could refuse `cross_check_*` keys on a `manual` round. Manual entry's strict Zod already prevents it.
2. Record a dropped parenthetical note (for example `<272K context length`) in the OpenAI outcome entry. That keeps visible the fact that the short-context price was the one read.
3. The `retiring` words could read "the second price list says the provider retires this model on <date>". The date comes from LiteLLM, not OpenAI.

### Awareness: LiteLLM `deprecation_date` 2026-10-23 (not in scope)
**No Business OS area depends on any of the six models.**
- **Live settings.** Read on 2026-10-15 with a read-only REST GET of `system_settings_config`:
  - chat, insights, briefing and leads use `gpt-4o-mini`;
  - website and intake use `gpt-4o` and `gpt-4o-mini`;
  - onboarding uses `gpt-4o`;
  - images uses `gpt-image-2.5-flare`;
  - `helpbot_embedding_model` is `text-embedding-3-small`.
- **Code.** `IMAGE_GENERATION_CONFIG_DEFAULTS.model` is `gpt-image-2.5-flare`. In `lib/business-os`, `gpt-image-1` appears only in tests, fixtures and one comment.
- **Not checked:** non-Business OS AgentsPilot flows (V6 and orchestration).
- **Effect on the first fetch.** Expect `retiring` on any of these models still in the coverage set through the in-code table (`gpt-4.1-nano`, `o4-mini`, `gpt-3.5-turbo`). `gpt-4` and `gpt-4-turbo` will read "not found on provider page". This is correct behaviour.

### Business questions
BQ-A and BQ-B stand as written; SA agrees with the Dev recommendations. There is no new business question. The user's OK for the hand-applied migration `20261069` (SC-7) is an operational gate, not a design question.

### Approval
[x] Workplan approved with changes SC-1..SC-16. Proceed after T-0 (BQ-A, BQ-B, migration OK). SC items are checked at code review.

---

**Code Review by SA — 2026-10-15** (uncommitted worktree `neuronforge-model-pricing-s3` on `86dd3266`)
**Status:** 🔄 Fix Required (two small fixes, F-1 and F-2). Once they are in, the code is approved for QA. SA does not need a full second pass: TL checks the two diffs against the exact fixes below.

**What SA verified directly**
- **Migration `20261069`.** SA extracted the function from `20261066` and diffed it against the new body (CRLF stripped). The only hunks are SC-3: (a) the array check is split from the count check, and `fetch` allows 0..200 lines, with a zero-line round needing an object for `p_provider_outcomes` (22023); (b) the zero-line `RETURN NEXT` comes after the round INSERT; (c) the five `cross_check_*` columns are in the lines INSERT. The statement list is exactly SC-2. The `RETURNS TABLE` text is byte-identical. `LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''` is restated. There is no `DROP`, `ALTER` or `ON TABLE`, and the four REVOKEs and the GRANT are present.
- **PG17 dry run (by reading).**
  - A zero-line `fetch` passes the duplicate check (0 = 0), stores the round (`outcomes_shape` allows an object), returns one row and stops.
  - A zero-line `manual` reaches the `ELSIF` and raises 22023.
  - A non-array now raises 22023 before `jsonb_array_length` runs. In slice 3, `OR` could evaluate the length on a non-array and raise 22023 with a different message. The SQLSTATE is the same, and the manual route maps only 23505 and 42501, so behaviour is unchanged.
  - The `::timestamptz` and `::numeric` casts read the ISO time and the 2-decimal text the code sends.
  - The `superseded_by` foreign key is deferred, so supersede-then-insert still holds.
- **Rollback.** Its function is byte-identical to slice 3 apart from `CREATE` becoming `CREATE OR REPLACE`. Its statement list matches SC-5a.
- **Checker.** Read-only from line 1. It runs 9 checks plus a VERDICT row, covering every SC-5 item.
- **Probe.** One DO block that always ends in an exception, with P01..P05.
- **Paste safety (SC-6), all four files.** "into" appears only as the two `INSERT INTO`s in the migration and the rollback. No `--`, no `/*`, no backslash, ASCII only, and no single-letter alias.
- **Number.** `20261069` is still free: it is in no ref (`git log --all`) and in no sibling worktree.
- **Live sources.** SA re-fetched the OpenAI page on 2026-10-15: 200, `text/markdown`, 23,231 bytes. The fixture rows are verbatim from it, so the fixture is realistic. A1, A3 and A4 all hold on the live page.
- **Production schema, one read-only REST GET.** All 23 `ai_model_pricing` OpenAI `model_name`s pass `MODEL_ID_REGEX`, and `ai_price_proposals` holds no rows yet.
- **Tests.** The slice suites (29 suites, 652 cases) are green. `git diff` is empty for `lib/ai/pricing.ts`, `lib/business-os/llm/`, `GeneratedImageService.ts`, `AiModelPricingRepository.ts`, `source.guard.test.ts`, `chargingUntouched.guard.test.ts`, the `20261066` migration and its test.

### Code Review Comments
1. **`lib/ai/pricing-research/fetchRound.ts` (`ProviderOutcomesSchema.parse`) and `app/api/admin/model-pricing/fetch-runs/route.ts` (the coverage set). Priority: High (F-1, blocking).**
   - **Problem.** `not_found` lists every OpenAI coverage id the page does not yield, and the strict schema requires each to pass `MODEL_ID_REGEX`. Coverage also comes from the area settings in `system_settings_config`, which are typed by an admin, plus the in-code tables. One id that fails the regex (for example `GPT-4o` or `ft:gpt-4o:…`) makes `.parse` throw. Every click then returns 500, and **no round is recorded, not even a zero-line one**. The status line and the 60 s anchor both go dark, which is exactly what O-1 = A was for.
   - **Fix.**
     - In the route, build the coverage set from ids that pass `MODEL_ID_REGEX` (import it from `pendingLineSchema`, which is pure).
     - When one or more ids are dropped, log one `warn` with `{ dropped: <count>, models: <ids> }`.
     - Add a `fetchRound` or route test: a coverage id `GPT-4o` gives 200 with a stored round, and the id is absent from `not_found`.
2. **`lib/ai/pricing-research/__tests__/chargingUntouched.guard.test.ts` (`SLICE_FILES`). Priority: Medium (F-2, blocking: the D-1 ruling below).**
   - **Fix.** Add one line, `join('app', 'api', 'admin', 'model-pricing', 'fetch-runs', 'route.ts'),`, after the `comparison/route.ts` entry. Edit no assertion.
   - **Keep** the route checks in `fetchSources.source.test.ts`: they are harmless redundancy.
   - **Check.** The route imports only `isInputOnlyPricedModel` from `@/lib/ai/pricing` (allowed) and calls none of the policed repositories, so the guard stays green.
3. **`route.ts` POST, the 60 s refusal (`elapsed >= 0 && elapsed < REFUSAL_WINDOW_MS`). Priority: Low.**
   - **Problem.** `created_at` comes from the database clock and `Date.now()` from the function's clock. When the database is ahead, `elapsed` is negative, and a second click inside the window is let through.
   - **Fix.** Use `const elapsed = Math.max(0, Date.now() - Date.parse(...))` and drop `elapsed >= 0`. Add a case for a round 2 s "in the future", which must give 409.
4. **`scripts/probe-ai-price-submit-pending-fetch-migration.sql` P05. Priority: Low.**
   - **Problem.** If `authenticated` ever held EXECUTE, the INVOKER body would still fail with 42501, because `authenticated` has no INSERT on `ai_price_proposals`. The `insufficient_privilege` handler would then report PASS for the wrong reason.
   - **Why it is Low.** Checker row 201 proves the grant independently.
   - **Fix.** In the handler, require `SQLERRM LIKE 'permission denied for function%'` (letters and spaces, so SC-6 allows it; add the pattern to the test's named exceptions). Otherwise set `v_fail`.
5. **`lib/ai/pricing-research/__tests__/openaiPricingAdapter.test.ts`. Priority: Low.**
   - **Problem.** The live page surrounds every anchor with whitespace-only lines and indented lines. The fixture's blank lines are empty. The parser trims, so it is correct today, but nothing pins that.
   - **Fix.** Add one case: replace every empty line with four spaces and indent the A1 and A4 label lines by six spaces. Expect the same 12 lines.
6. **`app/admin/system-config/components/ProviderPriceCheck.tsx`. Priority: Low.**
   - **Problem.** GET returns last success and last failure for LiteLLM too (SC-12), but only OpenAI's are drawn.
   - **Fix.** Render `historyLines(status.litellm)` under the cross-check line, and add one render assertion.

### Rulings on the deviations
- **D-1.** SC-16 as written: add the route to `SLICE_FILES` (F-2). **TL: please authorise that one-line, list-only edit.** The source-test "equivalent" is weaker than the guard:
  - it allow-lists only `@/lib/ai/pricing`, while the guard allow-lists four charging modules;
  - it does not police `systemConfigRepository` or `adminUserRepository` method calls.

  The guard is the slice's single "charging untouched" proof, and adding a file to its list only strengthens it. No assertion may change.
- **D-2.** Accepted.
  - Each edit keeps its slice 4 intent. The status read is counted exactly once, inside `waitFor`, and left out of the ordered lists.
  - R-9 finds the PUT by method.
  - T-14 is narrowed to exactly one "Check provider prices" button. This is deliberate and correct: Apply, Dismiss and History are still pinned absent.
- **D-5.** Accepted.
  - `.eq` and `.neq` on `provider_outcomes->openai->>outcome` (or `litellm`) is a documented PostgREST JSON-path filter.
  - The path comes from a closed union, so no caller text reaches it.
  - There is no `.or()`.
  - `.neq` excludes rows whose path is NULL. That is correct, because every fetch round this code writes carries the full object (it is schema-parsed before submit).
  - The volume is at most one row a minute, so no index is needed.
- **D-3, D-4, D-6, D-8, D-9.** Accepted.
- **D-7.** Verified: `fetchRound` overwrites the price fields from the parsed page line after spreading `snapshotFields`. The LiteLLM result reaches only `cross_check_*` and the flags.
- **D-10.** Accepted for review. QA must run one full `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` before the PR. No CI type gate covers these files.
- **D-11 and D-12 (test durations).** **Acceptable, no fix required.**
  - **SA measured on 8 cores.** Run in band, the only system-config case over 1 s is T-1 (2.1 s). It is the first case of `priceTable.render`, so the time is suite warm-up. In the parallel folder run, the maximum is 2.27 s, under half the 5 s default.
  - **Why this is not the slice 4 flake.** That flake was a real network leak (PR #340), and it is closed here: every new I/O suite calls `forbidRealNetwork()`, and the render suite's stub answers only `fetch-runs`.
  - **Trigger to act.** If any system-config case passes 3.5 s in CI, `jest.mock` `ProviderPriceCheck` in the four slice 4 page suites. That also removes the D-2 filters.

### Checklist against the review brief
- **Outbound fetch.** Two pinned URLs, equality-tested, and no input reaches a URL. `redirect: 'manual'`, with a 3xx giving `http_3xx`. The 10 s timer covers the headers and the body and is cleared in `finally`. Caps: 5 MB for OpenAI and 8 MB for LiteLLM, checked up front from `content-length` and while streaming. The fetch uses `allSettled` plus a `settledToResult` backstop, and `fetchLimited` never throws. Only a `User-Agent` and an `Accept` header are sent, and the User-Agent is honest. A 403 or a `text/html` answer gives `blocked`, and 429 gives `http_429` with no retry. `server-only` is imported. No page body is logged (guarded by a test).
- **OpenAI parser.**
  - **Anchors and table.** A1 to A4 are exactly per SC-10. A row's cells are read by column name, and the table ends at the first line that does not start with `|`.
  - **Order of checks.** Coverage is checked before any cell, and a wrong cell count goes to manual entry.
  - **Cells.** A cell that is not exactly one price goes to manual entry, with at most 80 characters kept. Digits are kept as written, with no float.
  - **Matching.** Candidates are deduped and regex-checked, and more than one coverage match goes to manual.
  - **Layout change.** `layout_changed` gives zero lines.
- **LiteLLM.** Values are read through `decimalFromNumberLiteral` and `shiftDecimal(+6)`. Agrees and the 5% flag are decided by the exact `movesBeyondBasisPoints`, and the rounded gap is used for display only. `retiring` comes from `deprecation_date`, and its words name the "second price list (LiteLLM)". No LiteLLM value reaches a price field.
- **Route.**
  - **Gate and input.** `requireAdmin` is the first statement, after only the correlationId and the logger, the same as `manual-entries`. The body must be an empty strict object, and GET refuses any query.
  - **Refusal.** A check within 60 s gives 409 `too_soon` with `retryAfterSeconds` and a `Retry-After` header.
  - **Recording.** The outcome of every provider is stored. A failed fetch still records a zero-line round.
  - **Audit.** `logAndFlush` writes `AI_PRICE_FETCH_RUN`, which is registered as `shared`; the pins are 201 / 54 / 63 / 84. The audit carries counts and model ids only.
  - **Status read.** GET returns the last run, last success and last failure per source.
  - **Standards.** Pino with a correlationId, the CLAUDE.md error envelope, details only in development, and the repository pattern only.
- **UI.** The button is `disabled` and `aria-busy` while busy. The status block is `role="status"` and always mounted. A refusal shows in a `role="alert"` box with the server's words. There is no `console.*` (pinned by `priceReview.source.test.ts`) and no number parsing in the browser.
- **CI.** Offline only. The no-LLM guard and the SC-15 literal guard are both in place. No new job.

### Optimisation Suggestions
- `crossCheckDetail` uses `Number(diff).toFixed(2)`. That is display only, so it is allowed under C-8. Printing the stored numeric's text as-is would avoid the float altogether.
- The render suite's stub throws on an unexpected URL, but `runPriceFetch` swallows the error. Asserting `calls` (already done in most cases) is what actually catches it.

### Confirmed production apply order
1. Before the PR is opened, re-check that `20261069` is free (SC-1).
2. CI is green and the user approves the diff. **Do not merge yet.**
3. With the user's explicit go-ahead, the user pastes `supabase/migrations/20261069_ai_price_submit_pending_fetch_rounds.sql` into the production SQL editor. This is safe before the deploy because the new body is a superset: live manual entry sends at least one line and no `cross_check_*` keys.
4. Run `scripts/check-ai-price-submit-pending-fetch-migration.sql`. Expect `VERDICT PASS`, "9 pass 0 fail".
5. Re-run the **unchanged** slice 3 checker. Expect PASS 68/0, which shows the trigger, the C-1 column grant, RLS and the policies held.
6. Optional: run the probe in a fresh tab after `SET default_transaction_read_only TO off`. Expect the error text `PROBE PASS … P01..P05 PASS`. It writes nothing.
7. Merge the PR (the code deploys), then run the section 12 manual check.
8. **Rollback, only if needed:** revert the deploy **first**, then run `supabase/SQL Scripts/20261069_ai_price_submit_pending_fetch_rounds_rollback.sql`, then re-run the slice 3 checker.

### Code Approved for QA: Yes, conditional on F-1 and F-2. F-3 to F-6 are Low; do them in the same pass if cheap. None of them blocks QA.

## QA Testing Report

**QA — 2026-10-15**
**Test mode:** full
**Strategy used:** A + B (Jest re-runs, offline), mutation testing on scratch copies, static checks, and a review of the §12 manual check. There was no browser check: the button reads live third-party pages and the database, so it is checked by the user after deploy (§12).
**Focus:** api, ui, schema, security, performance (flakes)
**Skipped:** e2e (needs the deployed app and the production migration; see the tightened §12 below)
**Input source:** TL prompt

The tests ran on uncommitted code in worktree `neuronforge-model-pricing-s3` (base `86dd3266`). No source file was edited, nothing was staged or stashed, and no database or live source was touched. Mutants were written to the session scratchpad and swapped in through a scratch Jest `moduleNameMapper`. SQL and route mutants used a scratch copy of the test that points at the mutated file. Eight unmutated controls, one per mutated module, all passed.

### Test Coverage
| Acceptance criterion / check | Tested? | Result | Notes |
|---|---|---|---|
| Parser reads Standard only, digits as written, strict cells, anchors fail loudly (RR-1, SC-10) | ✅ | Pass | Mutants M01–M05 all killed |
| LiteLLM cross-check: exact thresholds (SC-11) | ⚠️ | Partial | The 5% flag boundary is pinned. The 1 bp "agrees" boundary is not (M06c, M06e survive) |
| A LiteLLM number is never a price (MP-FR-6a, D-7) | ⚠️ | Partial | The code is correct. The test catches LiteLLM leaking into the output price only by accident (`0.6` vs `0.60`). Leaks into the input or cached price survive (M07b, M07c) |
| `requireAdmin` first; empty strict body, no URL can be supplied (SC-9, SC-13) | ✅ | Pass | M08a–c and M11 killed |
| 60 s refusal: 409 `too_soon` + `Retry-After` | ✅ | Pass | M09a–c killed |
| Redirects never followed | ✅ | Pass | M10a–b killed |
| Migration: grants, cross-check columns, rollback byte-identical (SC-2..SC-6) | ✅ | Pass | M12a–c, M13a–b and M14a–b killed |
| UI busy state (disabled, `aria-busy`, label, re-enable) | ✅ | Pass | M15a–d killed |
| Source cell shows the cross-check words (O-12, `crossCheckDetail`) | ❌ | Untested | Not one test covers `crossCheckDetail()` or its use in `PriceRowCells`. X1 and X2 survive |
| All tests offline (SC-16) | ✅ | Pass | 27 suites and 514 tests passed with all egress blocked; 0 attempts (details below) |
| Static: no `console.*`, no model literals, no backslash + hex, paste-safe SQL | ✅ | Pass | Details below |
| Guards unedited; charging files untouched | ✅ | Pass | Empty diffs (details below) |
| Skill minimums: route happy, 401 and 400; a repository test per new method | ✅ | Pass | Route: 24 cases. Repository: `submitFetchRound`, `latestFetchRound`, `latestFetchRoundByOutcome` (ok and not_ok) |
| Entitlements | ✅ | Pass | No entitlements import. `test:bos-entitlements` is green anyway |

### Step 1: re-runs (counts verbatim)
| Command | Suites | Tests |
|---|---|---|
| `npx jest lib/ai/pricing-research --ci` | 12 passed, 12 total | 265 passed, 265 total |
| `npx jest app/api/admin/model-pricing --ci` | 3 passed, 3 total | 48 passed, 48 total |
| `npx jest app/admin/system-config --ci --verbose` run 1 / 2 / 3 | 8 passed, 8 total (×3) | 125 passed, 125 total (×3); 72.1 s / 113.3 s / 107.9 s |
| `npx jest supabase/migrations --ci` | 42 passed, 42 total | 2183 passed, 2183 total |
| `npm run test:bos-entitlements` | 269 passed, 269 total | 8031 passed, 8031 total |
| `npx jest lib/audit/__tests__ --ci` | 15 passed, 15 total | 180 passed, 180 total |
| `npm run test:authz-guard` | 2 passed, 2 total | 203 passed, 203 total |
| `npm run test:bos-llm` | 23 passed, 23 total | 627 passed, 627 total |
| Tailwind guard `app/__tests__/tailwind-css-escape.guard.test.ts` | 1 passed, 1 total | 6 passed, 6 total |
| `npm run check:bos-llm-literals` | — | 64 files in scope, 2 exempt, 0 violations. The new files are outside its scope by design; the SC-15 source guard covers them |

**Slowest 5 per `system-config` run** (parallel workers; the machine was loaded):
- Run 1: M-6b 2402 ms · E-2 2324 ms · E-3 2168 ms · M-3 2163 ms · R-9 1997 ms (4 cases over 2 s)
- Run 2: E-1 (500 on save) 4300 ms · R-5 2800 ms · T-1 2644 ms · R-1 2484 ms · E-2 2463 ms (10 cases over 2 s)
- Run 3: E-1 (500 on save) 5759 ms · T-1b 5067 ms · T-1 3528 ms · E-3 3302 ms · E-2 2619 ms (9 cases over 2 s)
- In-band (`-i`) on an idle machine: the slowest was T-1 at 1614 ms, then T-15 at 1168 ms. Nothing else was over 1 s. The new `providerPriceCheck` cases take 0.6–1.1 s.

### Step 2: mutation results (31 of 36 requested mutants killed)
| Mutant | Result | Killed by |
|---|---|---|
| M01 parser reads the Batch table | Killed | 22 adapter, round and route cases |
| M02 price through `Number()` | Killed | "takes the Standard price…", note, embeddings |
| M03 two-prices cell, first number taken | Killed | "a cell with two dated prices", "comma or unit suffix" |
| M04a no A3 / M04b A4 missing continues / M04c `layout_changed` lost | Killed / Killed / Killed | Anchor cases A3, A4, A1/A2 |
| M05 name rule falls back to a prefix match | Killed | 9 cases |
| M06a `>=` on both thresholds / M06b `>=` on the 5% flag | Killed / Killed | "exactly 5% is not flagged" |
| **M06c `>=` on the 1 bp "agrees" threshold** | **Survived** | The "1 bp" case is 0.9999 bp, not exactly 1 bp |
| M06d rounded basis points for the flag | Killed | "2.10001 … flagged" |
| **M06e rounded basis points for "agrees"** | **Survived** | No case has a gap between 1 and 1.5 bp |
| M07a LiteLLM value into the output price | Killed | Only because `0.6` ≠ `0.60` |
| **M07b LiteLLM value into the input price** | **Survived** | The fixture's LiteLLM values equal the page, so a leak looks identical |
| **M07c LiteLLM value into the cached input price** | **Survived** | Same cause |
| M08a POST without `requireAdmin` / M08b gate after the body read / M08c GET without the gate | Killed ×3 | Source-order pin + G 401/403 |
| M09a no 60 s refusal / M09b 25 s window / M09c no `Retry-After` | Killed ×3 | W 409 case |
| M10a `redirect: 'follow'` / M10b a 3xx read as a body | Killed ×2 | Redirect pin; the 301 case |
| M11 URL accepted from the body | Killed | "400 for a url" |
| M12a + GRANT authenticated / M12b GRANT to authenticated instead / M12c REVOKE authenticated dropped | Killed ×3 | Statement-list pin |
| M13a all cross-check columns dropped / M13b one column dropped | Killed ×2 | The five-columns case |
| M13c (extra) verdict and value swapped in the INSERT | Survived | Low: the DB CHECK on `cross_check_verdict` would refuse every line, and probe P03 catches it |
| M14a rollback message changed / M14b rollback allows 0 lines | Killed ×2 | Byte-for-byte rollback case |
| M15a not disabled / M15b no `aria-busy` / M15c static label / M15d never un-busy | Killed ×4 | The "is busy while the check runs" case (M15d also by the 409 case) |
| X1 (extra) `crossCheckDetail` always "not run" | Survived | No test |
| X2 (extra) `PriceRowCells` ignores `crossCheckDetail` | Survived | No test |

Not mutated: `test:authz-guard` reads the real route file from disk, so it was left as-is. Its `requireAdmin`-first rule is the same as the route test's source-order pin, which killed M08a–c.

### Step 3: offline proof
- **Code read:** the only `fetch(` is in `fetchSources.ts`, and `fetchLimited` is injected or mocked in every suite. `forbidRealNetwork()` is installed in the adapter, cross-check, fetchSources, fetchRound, route and repository suites. The UI suites replace `global.fetch` with stubs that throw on any URL not on their list. The SQL and source-guard suites only read files.
- **Run with the network blocked:** a scratch `setupFilesAfterEnv` replaced global `fetch` and blocked `net.Socket.connect` (TCP), `tls.connect`, `dns.lookup` and `http`/`https.request`, recording every attempt.
  - Scope: `lib/ai/pricing-research`, `app/api/admin/model-pricing`, `app/admin/system-config`, the repository fetch-round test, the slice 5 migration test and `eventAudience`.
  - Result: **27 passed, 27 total; 514 passed, 514 total; 0 network attempts recorded.**
  - A positive control (a scratch test calling `fetch` and `https.get`) was blocked, and both attempts were logged.

### Step 4: static checks
- **`console.*`:** none in any new or modified non-test file.
- **Model-name literals:** `check:bos-llm-literals` passed. The SC-15 guard in `fetchSources.source.test.ts` is green.
- **Backslash followed by a hex digit:** none in any of the 39 changed or new non-doc files. There is no backslash at all in the 4 SQL files or the 2 fixtures.
- **Paste safety, 4 SQL files:**
  - ASCII only, no `--`, no `/*`, no backslash, LF line endings;
  - "into" appears 2 times in the migration and 2 in the rollback (the two `INSERT INTO` statements), and 0 in the checker and the probe;
  - the SC-6 test is green.
- **Guards unedited:** `git diff HEAD` is empty for `chargingUntouched.guard.test.ts`, `source.guard.test.ts` and `ai-model-pricing-slice3.migration.test.ts`.
- **Charging files:**
  - The three-dot diff `origin/main...HEAD` is empty. That is trivially true, because the work is uncommitted.
  - The working tree diff against the base is also empty for `lib/ai/pricing.ts`, `lib/business-os/credits`, `lib/business-os/llm`, `lib/services/GeneratedImageService.ts`, `lib/repositories/AiModelPricingRepository.ts` and `app/api/admin/ai-pricing`.
- **Main drift:** origin/main is 33 commits ahead (`3d4122a9`). The only file both sides touch is `docs/requirements/AI_MODEL_PRICE_REVIEW_REQUIREMENT.md`, so expect a docs-only merge conflict.
- **Migration number:** `20261069` is still free on every ref and in every sibling and nested worktree.

### Issues Found

#### Bugs (must fix before commit)
1. **The "a LiteLLM number is never a price" invariant is not really tested** — File: `lib/ai/pricing-research/__tests__/fetchRound.test.ts` (and/or the route test) — Severity: Medium
   - Steps to reproduce: mutate `fetchRound.ts` so that `input_per_1m` or `cached_input_per_1m` takes the LiteLLM value (M07b, M07c). The full suite stays green.
   - Expected: a case where LiteLLM **disagrees** with the page (for example a list entry 10% off on all three units) asserts that `input_per_1m`, `cached_input_per_1m` and `output_per_1m` equal the page cells exactly, and that the LiteLLM value appears only in `cross_check_value`.
   - Actual: every fixture line agrees with LiteLLM, so a leak is invisible. The output leak is caught only by the `0.6` / `0.60` formatting difference.
2. **The cross-check words in the source cell (O-12) have no test** — Files: `lib/ai/pricing-research/comparisonModel.ts` (`crossCheckDetail`) and `app/admin/system-config/components/PriceRowCells.tsx` — Severity: Medium
   - Steps to reproduce: make `crossCheckDetail` return "not run" (X1), or make `PriceRowCells` render `view.crossCheck` instead (X2). All suites stay green.
   - Expected:
     - a unit case per verdict: agrees; differs with and without `diff_pct`; not_listed; unavailable; null;
     - a render assertion that a row with `crossCheckDetail` shows those words;
     - §12 step 3 relies on these words.
   - Actual: zero coverage.
3. **The 1 bp "agrees" boundary is not pinned** — File: `lib/ai/pricing-research/__tests__/litellmCrossCheck.test.ts` — Severity: Low
   - Steps to reproduce: change the agree check to `>=` (M06c), or to rounded basis points (M06e). Both survive.
   - Expected: like the 5% case, an exactly-1 bp gap agrees (official `2`, LiteLLM `2.0002e-6`), and a gap of about 1.2 bp differs (rounded gap 1, exact gap beyond).
   - Actual: the existing "1 bp" case is 0.9999 bp.
4. **Probe P05 can pass for the wrong reason** — File: `scripts/probe-ai-price-submit-pending-fetch-migration.sql` — Severity: Low
   - Steps to reproduce (reasoning): under `SET LOCAL ROLE authenticated`, if EXECUTE were wrongly granted, the function's own `admin_users` read could still raise `insufficient_privilege` (42501). P05 would then read PASS.
   - Expected: the checker row "S2 anon and authenticated cannot execute" is the authority. It is exact (`has_function_privilege`), so P05 is only a secondary signal.
   - Actual: P05 alone does not prove the grant. No change is needed if the checker stays mandatory.
   - Same finding as SA F-4. Edge case 1 below is SA F-3.
5. **QA confirms SA F-1 (High), by reading the code** — Files: `lib/ai/pricing-research/fetchOutcomes.ts` (`modelId` regex on `not_found`), `fetchRound.ts` (`ProviderOutcomesSchema.parse`), `route.ts` (the coverage set).
   - A coverage id that fails `MODEL_ID_REGEX` reaches `not_found`. The `parse` call then throws, the route's catch answers 500, and no round is stored.
   - No test or mutant covers it, because the guard is missing rather than wrong.
   - The SA review was written in parallel with this QA pass. QA ran on the code before F-1 and F-2 were fixed, so after the fix, re-run the slice suites and mutants M07b, M07c, X1 and X2.

#### Performance Issues (should fix)
1. There is no index on `ai_price_proposals (source_kind, created_at)`. Each GET does 5 newest-round reads and each POST does 1. The table holds one row per press, so this is negligible today. Revisit if rounds grow large (later slice, not here).

#### Edge Cases (nice to fix)
1. The 60 s refusal is skipped when the stored `created_at` is ahead of the server clock (`elapsed >= 0` guard). This is harmless because the button is disabled while busy.
2. The UI shows only a count of refused lines. The route returns `problems` (which model, and why), but the component never shows them.
3. The LiteLLM line omits the `unavailable` count. When OpenAI failed but LiteLLM was read, it shows "0 agree, 0 differ, 0 not listed."
4. Wording: "the pricing page layout changed; no prices were read at <time>." reads as if the time belongs to "no prices were read".

#### Flake risks
- **Highest:** pages.edge.qa **E-1** ("a 500 on save…"). It took 5759 ms and 4300 ms in parallel runs, against Jest's default 5 s timeout. T-1b took 5067 ms once.
- **Over 2 s at least once in a loaded parallel run:** E-1, E-2, E-3, T-1, T-1b, R-1, R-5, R-9, M-1, M-3, M-6b, T-2, T-7 (13 cases). These are all pre-existing slice 4 page cases. Slice 5 adds the status GET on page open, so it adds some time to each.
- In-band on an idle machine, none of them exceeds 1.7 s. None of the new slice 5 cases exceeded 1.1 s.
- The slice 4 flake (D-12, T-14) did not recur in 3 parallel runs plus 2 in-band runs.

### §12 manual check: tightened for the user
1. **Before the apply:** run the unchanged slice 3 checker and note two INFO rows: V5 "price row counts" and V6 "charged price fingerprint".
2. **Apply `20261069`** (with the user's go-ahead) **before** the code deploys.
3. **Run the slice 5 checker.** Expect `VERDICT | PASS | 9 pass 0 fail`.
4. **Re-run the slice 3 checker.** Expect `VERDICT | PASS | 68 pass 0 fail`, and the same V5 counts and V6 fingerprint as in step 1.
5. **Optional probe:**
   - Run it in a **new** SQL tab. The checker makes its tab read-only, and the probe then says "PROBE SKIPPED … read only".
   - Expect an ERROR whose message starts `PROBE PASS` and lists P01–P05 PASS. The error is intended: it rolls everything back.
6. **Deploy.** Before pressing anything, the status block reads "OpenAI: not checked yet."
7. **Press "Check provider prices".**
   - The button turns grey and reads "Checking provider prices…".
   - Within about 30 s:
     - "Saved as pending prices. Nothing is charged until a price is applied.";
     - "OpenAI: N prices read <date time> UTC; …";
     - "Anthropic, Google and Kimi: manual entry for now.";
     - "Second price list (LiteLLM): A agree, D differ, L not listed.";
     - the "Image prices: manual entry" line.
   - Expect `gpt-4` and `gpt-4-turbo` under "Not on the provider page".
   - If the status says "the provider blocked the check" instead, write that down. It means OpenAI refuses requests from Vercel's servers. The sources were verified only from a developer machine, so this is the one outcome no test can predict. It is a valid outcome, not a failed deploy.
8. **The table refreshes.**
   - OpenAI rows show the provider price with coloured chips.
   - The source cell reads "Cross-check: agrees with the second price list, read <date>; second price list (LiteLLM): input …", or "differs from the second price list by up to X%".
   - Models with a LiteLLM retirement date (for example `gpt-4.1-nano`, `o4-mini`, `gpt-3.5-turbo`, if in coverage) carry the retiring flag.
9. **Press again within 60 s.** A red alert reads "Prices were checked less than a minute ago. Try again in N s." and no new status time appears.
10. **Nothing live changed.**
    - The "In effect since" dates are unchanged.
    - Re-run the slice 3 checker: V5 still reads 0 rows for both, and the V6 fingerprint is identical to step 1.
11. **Rollback, if ever needed:** revert the deploy first, then run the rollback SQL. Done the other way round, every zero-line fetch returns a 500.

### Final status (pass 1, superseded by the re-pass below)
- [ ] All acceptance criteria pass — ready for commit
- [x] Issues found — Dev must address before commit:
  - SA F-1 (High, confirmed by QA as bug 5) and F-2 are open.
  - QA bugs 1 and 2 (Medium) are missing tests on two slice invariants.
  - Bug 3 (Low) should be fixed in the same pass.
  - Bug 4 (= SA F-4) and the edge cases are optional.
  - Apart from F-1, QA found no functional defect.

### QA re-pass (2026-10-15)

**Scope:** SA F-1..F-6, QA bugs 1–3, D-13 (the `ProviderPriceCheck` mock in the four slice 4 page suites), and the merge of origin/main `3d4122a9`. Worktree `neuronforge-model-pricing-s3`, HEAD `3d4122a9`, uncommitted. No source edited, nothing staged or stashed, no DB or live source touched. Exports and mutants live in the session scratchpad only.

#### Re-pass step 1: re-runs (counts verbatim) — Pass
| Command | Suites | Tests |
|---|---|---|
| `npx jest lib/ai/pricing-research --ci` | 13 passed, 13 total | 276 passed, 276 total |
| `npx jest app/api/admin/model-pricing --ci` | 3 passed, 3 total | 51 passed, 51 total |
| `npx jest lib/repositories/__tests__/AiPriceProposalRepository --ci` | 2 passed, 2 total | 16 passed, 16 total |
| `npx jest supabase/migrations/__tests__/ai-model-pricing-slice5 --ci` | 1 passed, 1 total | 39 passed, 39 total |
| `npx jest app/admin/system-config --ci --verbose`, 3 runs in parallel | 9 passed, 9 total (×3) | 128 passed, 128 total (×3); 70.1 s / 69.1 s / 69.1 s |
| `npx jest supabase/migrations --ci` | 42 passed, 42 total | 2183 passed, 2183 total |
| `npm run test:bos-entitlements` | 270 passed, 270 total | 8018 passed, 8018 total |
| `npx jest lib/audit/__tests__ --ci` | 15 passed, 15 total | 177 passed, 177 total |
| `npm run test:authz-guard` | 2 passed, 2 total | 203 passed, 203 total |
| `npm run test:bos-llm` | 23 passed, 23 total | 627 passed, 627 total |
| Tailwind guard `app/__tests__/tailwind-css-escape.guard.test.ts` | 1 passed, 1 total | 6 passed, 6 total |
| Extra: origin/main's new G-1 guard `mockedRepositoryMethods.guard.test.ts` (`f46642b3`, not yet in this branch), run against the worktree from a scratch copy | 1 passed, 1 total | 13 passed, 13 total |

**Slowest 5 per `system-config` run** (3 Jest processes at once on 8 cores, so about 21 workers):
- Run 1: T-1 3743 ms · E-1 (500 on save) 2884 ms · E-2 2677 ms · E-3 2465 ms · E-1 (thrown fetch) 2256 ms. At or over 2.5 s: **T-1, E-1, E-2**.
- Run 2: T-1 3992 ms · E-1 (500 on save) 3079 ms · E-3 2525 ms · T-1b 2374 ms · E-2 2315 ms. At or over 2.5 s: **T-1, E-1, E-3**.
- Run 3: T-1 3846 ms · E-1 (500 on save) 3176 ms · R-9 3159 ms · E-2 2754 ms · T-1b 2537 ms. At or over 2.5 s: **T-1, E-1, R-9, E-2, T-1b**.
- The new suites: the slowest `providerPriceCheck` / `sourceCell` case was 1364 / 1289 / 1966 ms.

**These are not slice 5 time.** The same three-parallel run on a scratch export of HEAD (slice 4 only, no slice 5; 7 suites, 111 tests) gave 4 / 4 / 5 cases at or over 2.5 s, with a maximum of 3556 ms (E-1, 500 on save), and the wall time was longer (84.3 s / 86.6 s / 82.7 s). The same cases are flagged in both trees, and they are all slice 4 page cases (T-1 is the warm-up case of `priceTable.render`). D-13 worked: the worst case fell from 5759 ms in pass 1 to 3992 ms, under Jest's 5 s default. T-1 passes SA's 3.5 s trigger only under this artificial three-process load, and the baseline without slice 5 passes it too, so no action is needed.

#### Re-pass step 2: the count drops come from origin/main — Pass (no tests lost by the slice)
Method: `git archive` of `86dd3266` (pre-merge base) and of HEAD `3d4122a9` (merged main, no slice files) into the scratchpad. Each was run with a scratch Jest config: `rootDir` is the export, `modulePaths` is the worktree's `node_modules`, and the working directory is the export, since several guards read `process.cwd()`. The test names were diffed from `--json`.

| Tree | `lib/audit/__tests__` | `test:bos-entitlements` set |
|---|---|---|
| `86dd3266`, no slice | 15 suites, 180 tests | 267 suites, 7982 tests |
| HEAD `3d4122a9`, no slice | 15 suites, **177** tests | 268 suites, **7969** tests |
| Worktree (HEAD + slice 5) | 15 suites, 177 tests | 270 suites, 8018 tests |

- **`lib/audit` 180 → 177 is main's.** All of it is in `ownerAuditReads.guard.test.ts` (14 → 11), from DE-1 (`fbb387b1`, PR #393). Three "data export read" cases and two negative controls were removed, and one case and one control were added ("the data export route reads no audit rows at all", "flags a data export route that reads audit rows again"). Between HEAD and the worktree the only difference is one renamed case in `eventAudience.test.ts`: the pin "62 shared" becomes "63 shared" (`AI_PRICE_FETCH_RUN`). That makes 0 cases added and 0 lost.
- **Entitlements 8031 → 8018 is main's −13.** `data-export/route.characterization` 27 → 23, `ownerAuditReads.guard` 14 → 11, `userDataExportReads` 29 → 11 (DE-1). The offsets are `UserPreferencesRepository.findTimezone` +8 (new, F-13 `71acf86f`) and `credits/serviceColumn.guard` 97 → 101 (a guard that scans files and grew with main's files). The slice adds the same +49 on both bases (7982 + 49 = 8031, 7969 + 49 = 8018): `AiPriceProposalRepository.fetchRounds` 10 and `ai-model-pricing-slice5.migration` 39. The name diff from HEAD to the worktree has no other change apart from the eventAudience rename and absolute-path-bearing names that differ only by root.

#### Re-pass step 3: mutants — 15 of 16 killed, controls green
Same harness as pass 1: mutated copies in the scratchpad, swapped in by a scratch `moduleNameMapper`, or by a scratch copy of the test that points at the mutated file.

| Mutant | Result | Killed by |
|---|---|---|
| M06c `>=` on the 1 bp "agrees" threshold | Killed | "exactly 1 basis point agrees; 1.2 basis points … differs" |
| M06e rounded basis points for "agrees" | Killed | Same case |
| M07a LiteLLM value into the output price | Killed | "LiteLLM disagreeing on every unit never reaches a price field" + happy path + route S |
| M07b LiteLLM value into the input price | Killed | "LiteLLM disagreeing on every unit…" |
| M07c LiteLLM value into the cached input price | Killed | "LiteLLM disagreeing on every unit…" |
| **X1a (pass 1 X1)** the read model sets `crossCheckDetail: 'not run'` instead of calling `crossCheckDetail(line)` (`comparisonModel.ts` line 366) | **Survived** | 6 suites, 70 tests green: `crossCheckDetail`, `comparisonModel`, comparison route, `priceTableRows`, `priceTable.render`, `sourceCell.render`. See bug R-1 |
| X1b `crossCheckDetail()` itself always returns "not run" | Killed | 5 `crossCheckDetail` unit cases |
| X2 `PriceRowCells` renders `view.crossCheck`, not the detail | Killed | `sourceCell.render` "shows the cross-check words from the server" |
| F-1a regex filter removed (`new Set(openaiCoverage)`) | Killed | F-1 case: Expected 200, Received **500** |
| F-1b filter removed and the warn removed | Killed | Same case |
| F-1c filter kept, warn removed | Killed | Same case (the warn is pinned) |
| F-3 `elapsed >= 0 &&` restored, no `Math.max` | Killed | "a round 2 s 'in the future' … still refuses (SA F-3)" |
| F-6 LiteLLM history lines not rendered | Killed | 2 `providerPriceCheck` status cases |
| PG1 page renders an inline "Check provider prices" button, not the component (mock bypassed) | Killed | **Only** `priceReview.source` "slice 5: the page renders the price check once…". The 4 mocked page suites stay green (79 of 80 pass), as expected. The source pin is what guards the wiring |
| PG2 page passes `onFinished={() => {}}` (no table re-read) | Killed | Same source case |
| Controls: route identity, page identity | Green (27/27, 80/80) | — |

#### Re-pass step 4: unedited files — Pass
- `git diff --numstat HEAD` is empty for:
  - `app/admin/system-config/__tests__/source.guard.test.ts`;
  - `supabase/migrations/__tests__/ai-model-pricing-slice3.migration.test.ts` and the `20261066` migration;
  - the charging files: `lib/ai/pricing.ts`, `lib/business-os/credits`, `lib/business-os/llm`, `lib/services/GeneratedImageService.ts`, `lib/repositories/AiModelPricingRepository.ts` and `app/api/admin/ai-pricing`.
- `chargingUntouched.guard.test.ts`: numstat `1 0`. The whole diff is one added `SLICE_FILES` line, with no assertion touched:

```diff
@@ -25,6 +25,7 @@ const SLICE_FILES = [
   join('lib', 'repositories', 'AiPriceProposalRepository.ts'),
   join('app', 'api', 'admin', 'model-pricing', 'manual-entries', 'route.ts'),
   join('app', 'api', 'admin', 'model-pricing', 'comparison', 'route.ts'),
+  join('app', 'api', 'admin', 'model-pricing', 'fetch-runs', 'route.ts'),
 ];
```

- D-13 check: the four slice 4 page suites differ from HEAD only by the 8-line `jest.mock` block. `priceTable.render` also keeps the T-14 narrowing. The D-2 call-list edits are gone.

#### Re-pass bugs
1. **R-1: the read-model wiring of the cross-check words is still unpinned** (the remainder of pass 1 bug 2). File: `lib/ai/pricing-research/__tests__/comparisonModel.test.ts`, or the comparison route test. Severity: Medium (test only; the code is correct).
   - Steps to reproduce: in `comparisonModel.ts`, change `crossCheckDetail: crossCheckDetail(line),` to `crossCheckDetail: 'not run',` (X1a). All 6 consuming suites stay green.
   - Expected: one assertion that a pending line with `cross_check_verdict: 'agrees'` (and a fetched-at time) builds a `PendingView` whose `crossCheckDetail` starts with "agrees with the second price list". §12 step 8 depends on this text reaching the cell.
   - Actual: the function is unit-tested (X1b killed) and the cell is render-tested (X2 killed), but nothing checks that the server puts one into the other.

No other bug. SA F-1..F-6 and QA bugs 1 and 3 are verified closed by the mutants above. Pass 1 edge cases 2–4 remain optional.

**Not re-run by QA:** the full `tsc --noEmit` (SA D-10). Dev reports it completed on 8 GB with 0 errors in touched files.

**Before the PR:** origin/main has moved to `f46642b3` (15 commits past `3d4122a9`). No changed file overlaps the slice, and main's new G-1 mock guard passes against this worktree (above). RM should still merge main and re-run CI. `20261069` must be re-checked free (SC-1).

#### §12 manual check: final version for the user
1. **Before the apply:** run the unchanged slice 3 checker. Note the INFO rows V5 "price row counts" and V6 "charged price fingerprint".
2. **Apply `20261069`** with the user's go-ahead, **before** the code deploys.
3. **Run the slice 5 checker.** Expect `VERDICT | PASS | 9 pass 0 fail`.
4. **Re-run the slice 3 checker.** Expect `VERDICT | PASS | 68 pass 0 fail`, with the same V5 counts and V6 fingerprint as in step 1.
5. **Optional probe:**
   - Run it in a **new** SQL tab. The checker leaves its tab read-only, and the probe would then say "PROBE SKIPPED … read only".
   - Expect an ERROR whose message starts `PROBE PASS` and lists P01–P05 PASS. The error is intended: it rolls everything back.
6. **Merge and deploy.** Open `/admin/system-config`. Before the first press, the "Provider price check" status reads "OpenAI: not checked yet." There is no LiteLLM line yet.
7. **Press "Check provider prices".**
   - The button turns grey and reads "Checking provider prices…".
   - Within about 30 s:
     - "Saved as pending prices. Nothing is charged until a price is applied.";
     - "OpenAI: N prices read <date time> UTC; …" (plus "need manual entry" / "not on the page" counts if any), then "Last successful check: <date time> UTC";
     - "Anthropic, Google and Kimi: manual entry for now.";
     - "Second price list (LiteLLM): A agree, D differ, L not listed.", with its own "Last successful check: …" line under it (F-6);
     - "Image prices: manual entry (OpenAI publishes them only in a calculator).".
   - Expect `gpt-4` and `gpt-4-turbo` under "Not on the provider page".
   - If the status says the provider blocked the check, write that down. It means OpenAI refuses requests from Vercel's servers. The sources were verified only from a developer machine, so this is the one outcome no test can predict. It is a valid outcome (a zero-line round is still stored, and a "Last failure: …" line appears), not a failed deploy.
   - Optional: in the Vercel logs for this request, a warn "Coverage ids that are not model ids were left out of the price check" means an area setting holds a malformed model id (F-1). The check still succeeded.
8. **The table refreshes.**
   - OpenAI rows show the provider price with coloured chips.
   - The source cell reads either "Cross-check: agrees with the second price list, read <date>; second price list (LiteLLM): …" or "Cross-check: differs from the second price list by up to X%…".
   - "Cross-check: not run" on every OpenAI row is a defect (see R-1).
   - Models that carry a LiteLLM retirement date (for example `gpt-4.1-nano`, `o4-mini` or `gpt-3.5-turbo`, if in coverage) have the retiring flag.
9. **Press again within 60 s.** A red alert reads "Prices were checked less than a minute ago. Try again in N s.", and no new status time appears.
10. **Nothing live changed.**
    - The "In effect since" dates are unchanged.
    - Re-run the slice 3 checker: V5 and the V6 fingerprint are identical to step 1.
11. **Rollback, if ever needed:** revert the deploy first, then run the rollback SQL, then re-run the slice 3 checker. Done the other way round, every zero-line fetch returns a 500.

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] Issues found — Dev must address before commit:
  - **R-1 (Medium, test only):** add one assertion that the read model fills `PendingView.crossCheckDetail` from `crossCheckDetail(line)` (kills X1a). No product code change is needed.
  - No High or functional bug is open. SA F-1..F-6 and QA bugs 1 and 3 are verified closed. All required suites are green.
  - Once R-1 is in, QA only needs to run `comparisonModel.test.ts` and X1a. No full re-pass is needed.
- **2026-10-15, R-1 closed (recorded by TL):** the case "slice 5 (QA R-1): the pending view carries the cross-check in words from the line" was added to `comparisonModel.test.ts`. Dev showed mutant X1a fails it (1 failed, 19 passed), with the file restored byte-identical (`cmp`). TL re-ran it: 20 passed, 20 total. `lib/ai/pricing-research` and `app/api/admin/model-pricing`: 16 suites, 328 tests passed. **Status: ready for commit.**

## Commit Info

| Item | Value |
|---|---|
| PR | #404 |
| Commit | `47c16a05` |
| Merge | `5ce4203f` |

### Production apply record (2026-10-15)

| Step | Result |
|---|---|
| Before state | 42/12/0, charged-price fingerprint `76c7cfe8e89e2464f9fa866668682426` |
| Migration | `20261069` applied |
| Slice 5 checker | PASS 9/0 |
| Slice 3 checker (re-run) | PASS 68/0 |
| Probe | PASS P01..P05, rolled back, 0 rows left |

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-14 | Created | Dev workplan for R-9 row 5. Sources verified by fetching both URLs. OpenAI's Standard and Specialized tables, cells and traps are recorded; images stay manual (the per-image prices sit in a JSX calculator). LiteLLM: URL pinned, entry shape recorded. Finding: the slice 3 submit RPC writes no `cross_check_*` column and refuses a zero-line round, so a function-only migration is proposed (O-1). Open questions O-1..O-13, business questions BQ-A and BQ-B. No code written |
| 2026-10-15 | SA workplan review | Approved with changes SC-1..SC-16. O-1 = A: a function-only `CREATE OR REPLACE`, migration `20261069`, with a checker, a rollback restoring the slice 3 body verbatim, and an optional rolled-back probe. Parser anchors tightened (A4 unit line, trimmed header cells, table end). Cross-check decided exactly (`movesBeyondBasisPoints`). `network_error` outcome added. GET returns the last failure. No model literals in feature code. No BOS area uses the six LiteLLM 2026-10-23 deprecations |
| 2026-10-15 | T-0 closed; SA changes folded in; implementation started | User decisions (via TL): BQ-A YES (the newest official reading supersedes a hand-typed pending price), BQ-B YES (image prices stay manual), migration `20261069` YES (production apply only with the user's go-ahead). `20261069` re-checked free. Status, section 4, section 5 files and T-0/T-1/T-8 updated per SC-1..SC-16 |
| 2026-10-15 | Code complete, uncommitted | T-1..T-9 done. Migration `20261069` (function-only `CREATE OR REPLACE`, same signature: the cross-check columns written, a zero-line `fetch` round allowed), rollback (the slice 3 function verbatim), read-only checker, rolled-back probe P01..P05, slice 5 migration test. `lib/ai/pricing-research`: `fetchSources`, `openaiPricingAdapter`, `litellmCrossCheck`, `fetchRound`, `fetchOutcomes`, with dated fixtures. Route `model-pricing/fetch-runs` POST and GET. `AI_PRICE_FETCH_RUN` registered (pins 201 / 54 / 63 / 84). Repository `submitFetchRound` and the newest-round reads. UI: the Check provider prices button and status lines. Authz register rows 108–109. Deviations D-1..D-12 in 11.1 |
| 2026-10-15 | SA code review | Fix Required, two small items: F-1 (filter the coverage ids by `MODEL_ID_REGEX` so one bad id cannot 500 every check and leave no round) and F-2 (D-1 ruled: add the route to `chargingUntouched.guard` `SLICE_FILES`, list-only). Low: F-3 (clock skew in the 60 s refusal), F-4 (probe P05 precision), F-5 (a whitespace-line fixture case), F-6 (LiteLLM history lines). D-2, D-5 and D-7 accepted; test durations acceptable. Migration verified against the slice 3 body: SC-2, SC-3, SC-5, SC-5a and SC-6 all hold. Apply order confirmed |
| 2026-10-15 | SA F-1..F-6 and QA fixes; merged origin/main | F-1 coverage ids filtered through `MODEL_ID_REGEX`, one warn `{ dropped, models }`, route test with `GPT-4o`. F-2 the route added to `chargingUntouched.guard` `SLICE_FILES` (TL-authorised, list only). F-3 `Math.max(0, …)` elapsed, test for a round 2 s in the future (409). F-4 probe P05 requires `permission denied for function%`. F-5 adapter case with whitespace-only blank lines and indented anchors. F-6 LiteLLM last success and last failure rendered. QA: LiteLLM disagreeing on all three units never reaches a price (M07a–c); `crossCheckDetail` unit cases and a source-cell render case (X1, X2); exact 1 bp boundary both sides (M06c, M06e); `ProviderPriceCheck` mocked in the four slice 4 page suites (D-13), slowest page case now 1.3 s in parallel. `git merge origin/main` fast-forwarded to `3d4122a9`; the requirement edits were re-applied with a three-way merge (one Change History conflict, both rows kept). `20261069` still free. Full `tsc --noEmit` (8 GB) completes: 0 errors in touched files. Uncommitted |
| 2026-10-15 | QA R-1: read-model wiring of `crossCheckDetail` pinned | New `comparisonModel.test.ts` case: a pending line with verdict `agrees` gives `PendingView.crossCheckDetail` "agrees with the second price list, read 2026-10-15; second price list (LiteLLM): …". Mutant X1a (`crossCheckDetail: 'not run'` at `comparisonModel.ts:366`) applied in place: the new case fails (1 failed, 19 passed); file restored, `cmp` byte-identical to the saved copy. Uncommitted |
| 2026-10-16 | Commit Info filled | PR #404, commit 47c16a05, merge 5ce4203f; production apply record of 2026-10-15 (`20261069` applied, checkers PASS 9/0 and 68/0, probe PASS and rolled back) |
