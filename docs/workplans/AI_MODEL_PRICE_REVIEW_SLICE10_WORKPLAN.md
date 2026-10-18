# Workplan: AI Model Price Review, Slice 10 (Anthropic price adapter)

> **Last Updated**: 2026-10-18

**Developer:** Dev
**Requirement:** [AI_MODEL_PRICE_REVIEW_REQUIREMENT.md](/docs/requirements/AI_MODEL_PRICE_REVIEW_REQUIREMENT.md): R-9 row 10; UF-1; MP-FR-3, MP-FR-6a, MP-FR-12 as amended; SA Re-review RR-1 (fetch design, generic name rule), RR-2 (pending-only writes), RR-7, RR-8 (a new outbound URL needs an SA ruling); BQ-4 (Google and Kimi stay manual); slice 5 BQ-A (a fetched reading supersedes a hand-typed pending price) and BQ-B (images manual); slice 7 SA code review F-1 (cached input is charged for OpenAI only); the follow-up note "Anthropic cache-read tokens are not costed"
**Branch:** `feature/ai-model-price-review-slice10` (worktree `neuronforge-model-pricing-s10`, off origin/main `399070d4`, slices 1–9 merged; slice 9 as PR #464)
**Date:** 2026-10-18
**Status:** Code Complete (2026-10-18). SA approved with conditions SC10-1..SC10-9 (folded in); user decision B-1 "Oldest of the two"; T-0 clean. Uncommitted, awaiting SA code review and QA.

## Overview

Slice 10 makes the existing **Check provider prices** button read Anthropic's official prices as well as OpenAI's. One click now reads three sources in parallel: OpenAI's pricing page, Anthropic's pricing page (both in their official markdown form), and LiteLLM's public price list (the cross-check). A new fixed, deterministic Anthropic parser turns the "Model pricing" table into pending token lines for the Anthropic models we already cover. LiteLLM checks them exactly as it checks OpenAI's. Every line goes through the slice 3 schema, the bounds and the submit RPC, in the **same** `fetch` round as OpenAI's lines. Each provider keeps its own outcome, so if one provider fails, the other's lines still load.

**Nothing live changes.** `ai_model_pricing` and `ai_model_image_pricing` are not written, and no charge changes until an admin applies a line (slice 8). **Anthropic cache prices are not proposed:** our Anthropic calls never use prompt caching, and charging never reads a cache rate for Anthropic. The page's cache columns are checked as part of the layout anchor and noted as a flag, but no value is stored. **No migration** is needed. Google and Kimi stay manual entry (BQ-4).

## Table of Contents

1. [Analysis](#1-analysis) · 2. [Sources, verified today](#2-sources-verified-today) · 3. [Design](#3-design) · 4. [Files](#4-files) · 5. [Tests and CI](#5-tests-and-ci) · 6. [Security](#6-security) · 7. [Risks](#7-risks) · 8. [Task list](#8-task-list) · 9. [Open questions for SA](#9-open-questions-for-sa) · 10. [Business questions](#10-business-questions) · 11. [Manual check](#11-manual-check-user-after-deploy) · [SA Review Notes](#sa-review-notes) · [QA Testing Report](#qa-testing-report) · [Commit Info](#commit-info) · [Change History](#change-history)

---

## 1. Analysis

Read on origin/main `399070d4` in this worktree.

| # | Fact | Consequence |
|---|---|---|
| F-1 | `ai_price_submit_pending` (`20261069`) takes lines as a JSON array. **Each line carries its own `provider`.** The duplicate check is per `provider|model|kind|size|quality`, the limit is 0..200 lines for `fetch`, and `provider_outcomes` only has to be a JSON object (function check; the table CHECK in `20261066` asks only `jsonb_typeof = 'object'` for `fetch`) | **One round can hold both providers' lines.** No function or table change: **no migration**. About 25 OpenAI and 8 Anthropic lines are well inside 200 |
| F-2 | `PENDING_LINE_FLAGS` is mirrored by a table CHECK (`20261066`) | No new flag may be added without a migration. Slice 10 reuses the existing flags (`cached_input_listed`, `retiring`, `cross_check_*`, `new_model`, `large_move`) |
| F-3 | `ProviderOutcomesSchema` (`fetchOutcomes.ts`) is `.strict()`, with `anthropic: ManualOnlySchema`. Every stored slice 5 round holds `anthropic: { outcome: 'manual_only' }` | The read schema for `anthropic` becomes `AdapterOutcome` **or** `manual_only`, so old rounds still read. New rounds always write the adapter shape (pinned by a test) |
| F-4 | `latestFetchRoundByOutcome(source, 'not_ok')` filters `.neq('provider_outcomes->openai->>outcome', 'ok')`. `FetchOutcomeSource` is `'openai'` or `'litellm'` | Widened to `'anthropic'`. For Anthropic, `not_ok` must also exclude `manual_only`: an old round is not a failure. That is a second `.neq` on the same path, never `.or()` (the PostgREST bug) |
| F-5 | `PROVIDER_FETCH_MODE.anthropic = 'manual'`. `manualProviders()` feeds the status line, the audit details and the GET response | Set to `'adapter'`. Manual providers become Google and Kimi |
| F-6 | `PRICE_SOURCES` has exactly two entries. `fetchSources.source.test.ts` pins the full URL list to three literals, and `fetch(` appears only in `fetchSources.ts` | **New outbound URL: SA ruling needed (RR-8).** A deliberate edit of the pin from three URLs to five (Anthropic markdown and human page). `fetch(` stays in one file |
| F-7 | `buildFetchRound` (`fetchRound.ts`) is written for OpenAI only: one adapter call, `provider: 'openai'`, and `crossCheckLine(list, 'openai', …)` | It becomes provider-generic: a loop over the adapter providers, each with its own parse result, lines, refused list and outcome. OpenAI's result must stay identical (its tests stay green, except the `anthropic` outcome key; see 5.2) |
| F-8 | `matchModelCell` (`openaiPricingAdapter.ts`): trim, lower case, drop **one** trailing note matched by `[(]([^()]*)[)]$`, spaces to hyphens, candidates with dots kept or turned into hyphens, `MODEL_ID_REGEX`, coverage first, more than one match means manual (SA SC-10) | Anthropic's display names ("Claude Sonnet 4.6") give `claude-sonnet-4-6`, the API id, under that rule. **But** Anthropic's notes hold a markdown link (`([retired, except on Bedrock and Google Cloud](https://…))`), whose `(` `)` the note pattern refuses. Links must be reduced to their text first (3.3) |
| F-9 | Anthropic models in our coverage (in-code `FALLBACK_PRICING`, verified in `lib/ai/pricing.ts`): `claude-opus-4-6`, `claude-sonnet-4-6` (dateless) and eleven **dated** ids (`claude-sonnet-4-5-20250929`, `claude-haiku-4-5-20251001`, `claude-opus-4-5-20251101`, `claude-opus-4-1-20250805`, `claude-opus-4-20250514`, `claude-sonnet-4-20250514`, five Claude 3.x). The active database rows are the same set (slice 2 capture), re-read at T-0 | Under the exact name rule, only the two dateless ids would match. The dated ids need a **generic snapshot rule** (3.3, O-1): no per-model table (RR-1, CLAUDE.md rule 5) |
| F-10 | The slice 2 capture counted Anthropic calls in 90 days: `claude-haiku-4-5-20251001` 201, `claude-sonnet-4-6` 93, `claude-sonnet-4-5-20250929` 8, `claude-opus-4-6` 2. No Business OS area uses an Anthropic model (SA slice 5 awareness note) | These prices drive AgentsPilot agent-platform costs, not Business OS credits. A wrong Anthropic price is still a wrong recorded cost, so the same controls apply |
| F-11 | **Cache prices are not charged for Anthropic.** `anthropicProvider.ts` costs a call with `calculateCostSync('anthropic', model, usage.input_tokens, usage.output_tokens)`, with no cache read or cache write tokens. No file in `lib/` or `app/` sends `cache_control` (grep), so no Anthropic call ever creates or reads a cache. The comparison shows non-OpenAI cached input as "not compared" (slice 3 O-8, slice 7 F-1). The apply stale check expects cached `NULL` for non-OpenAI (`20261079`). The apply panel labels a non-OpenAI cached price "stored, not charged" | The adapter **does not propose** a cached price for Anthropic (3.3, O-3). Cache writes (5 min and 1 h) have no column anywhere and are not read either. This keeps the record truthful: nothing pending looks chargeable when it is not |
| F-12 | `isInputOnlyPricedModel('anthropic', …)` is always false | Anthropic has no input-only model. A missing output cell sends the model to manual entry |
| F-13 | The FR-12 conservative rate for Anthropic is the maximum of the in-code Anthropic rows: $15 / $75 per 1M (Opus 4 and 4.1) | A future model above it (for example a $50 output) gets `above_conservative_rate` (informational). Nothing in today's coverage is above it |
| F-14 | `lastCheckKpi` (`priceKpis.ts`) reads only `status.openai.lastOkAt` | With two automatic providers the KPI must consider both (B-1) |
| F-15 | `PRICE_REVIEW_NOTE`, the help drawer in `page.tsx` and `ProviderPriceCheck` all say "Anthropic, Google and Kimi … by hand" | Copy changes (3.7). `source.guard.test.ts` pins no such text (checked) |
| F-16 | `anthropicProvider.ts` holds 7 `console.*` calls | **Not touched by this slice** (no change to how Anthropic is called or charged), so CLAUDE.md § Logging does not trigger. Recorded here for the charging-accuracy follow-up |

**Skills applied:** `new-api-route` (the existing route keeps `requireAdmin` first, Zod, Pino with correlationId, `logAndFlush`); `tenant-isolation-guard` (no caller-supplied id or URL; service-role RPC re-checks `admin_users`; unchanged); `business-os-schema-check` (columns and checks read from `20261066` / `20261069` / `20261079` in this worktree). `bos-llm-call-standards` does not apply: there is no AI call (RR-1, MP-NFR-7 N/A). No entitlements import.

---

## 2. Sources, verified today

Fetched 2026-10-18 at 11:31 UTC from a plain client with the product's User-Agent (`PRICE_CHECK_USER_AGENT`) and `Accept: text/markdown, text/plain`. Copies are in the session scratchpad; the fixture is cut from a re-capture at T-2 (8.1).

**Anthropic pricing, markdown form.** Fetch `https://platform.claude.com/docs/en/about-claude/pricing.md`; store `https://platform.claude.com/docs/en/about-claude/pricing` as `source_url` (`platform.claude.com` is already on the Anthropic allow-list in `officialSources.ts`).
- 200, `text/markdown; charset=utf-8`, `Content-Length: 50428`, 534 lines, **no redirect** (served by an internal rewrite, `x-middleware-rewrite: /docs/as-markdown/en/about-claude/pricing`). `Cache-Control: private, no-store`. Cloudflare sets a `__cf_bm` bot-management cookie; it is not needed and not sent back. `docs.anthropic.com` redirects, so it is not used (a redirect would read `http_3xx`).
- **Front matter** names the canonical page: `url: https://platform.claude.com/docs/en/about-claude/pricing`.
- **Main table.** The heading `## Model pricing` appears **exactly once** as a whole line (the words appear 4 times in total, the other three inside links). The first table after it has the header cells, exactly: `Model | Base input tokens | 5m cache writes | 1h cache writes | Cache hits and refreshes | Output tokens`. 22 rows today. Cells read `$3 / MTok`, `$0.125 / MTok`, `$0.25 / MTok<sup>1</sup>` (a footnote), `$2 / MTok<sup>3</sup>`.
- **Rows are keyed by display name**, not API id: `Claude Sonnet 4.6`; `Claude Opus 4.1 ([retired, except on Bedrock and Google Cloud](https://platform.claude.com/docs/en/about-claude/model-deprecations))`; `Claude Mythos 5 ([limited availability](https://support.claude.com/…))`; `Claude Haiku 5.5 (for prompts up to 100,000 tokens)` and `… (for prompts over 100,000 tokens)` (two rows, one model, priced by prompt length).
- **Other tables with a `Model` first column:** Fast mode `| Model | Input | Output |` (cells `$8 USD / MTok`), Batch `| Model | Batch input | Batch output |`, tool-use and specific tools. None is read.
- **Footnotes** under the main table: cache-hit multipliers (0.1x, 0.05x, 0.025x) and footnote 3, which says Sonnet 5's former introductory $2 / $10 price "is now the standard price".
- **Other modifiers on the page:** data residency (US-only inference via `inference_geo` costs 1.1x; we never send `inference_geo`), long context (Claude 4.6 and later at standard price across 1M tokens; Haiku 5.5 tiered by prompt length), batch 50% off. All are informational under R-1 (batch and long context are flags only).
- **Backslashes:** five lines (escaped underscores and tildes in prose), all in the tool-pricing sections. None is in the sections the fixture keeps.
- **Expected outcome against today's coverage** (F-9):

| Coverage id | Page row | Read | LiteLLM (fetched today) |
|---|---|---|---|
| `claude-opus-4-6` | Claude Opus 4.6 (exact) | 5 / 25 (no change) | agrees |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 (exact) | 3 / 15 (no change) | agrees |
| `claude-opus-4-5-20251101` | Claude Opus 4.5 (snapshot rule) | 5 / 25 | agrees |
| `claude-sonnet-4-5-20250929` | Claude Sonnet 4.5 (snapshot rule) | 3 / 15 | agrees; `deprecation_date 2026-11-30` → `retiring` (Anthropic's own deprecations page says the same: deprecated 2026-09-30, retiring 2026-11-30) |
| `claude-haiku-4-5-20251001` | Claude Haiku 4.5 (snapshot rule) | 1 / 5 | agrees |
| `claude-opus-4-1-20250805`, `claude-opus-4-20250514`, `claude-sonnet-4-20250514` | rows with a "retired, except on …" note (snapshot rule) | 15 / 75, 15 / 75, 3 / 15 | `not_listed` (LiteLLM dropped them) |
| `claude-3-5-haiku-20241022` | "Claude Haiku 3.5" normalises to `claude-haiku-3-5`: the word order differs from the id | not found on provider page | — |
| `claude-3-5-sonnet-20241022`, `claude-3-opus-20240229`, `claude-3-sonnet-20240229`, `claude-3-haiku-20240307` | not on the page (retired) | not found on provider page | — |

**Model ids, from Anthropic's own pages** (read for the design, **not** fetched by the product):
- `…/about-claude/models/model-ids-and-versions.md`: dated ids are the pinned snapshots of a model, for example `claude-sonnet-4-5-20250929`, `claude-haiku-4-5-20251001`.
- `…/models/overview.md`: "Every Claude model ID is a pinned snapshot, including the dateless IDs used from the 4.6 generation on"; "For models before the 4.6 generation, the alias is a convenience pointer that resolves to the dated ID". Its table lists only the current four models.
- `…/about-claude/model-deprecations.md`: a "Model status" table of API ids (dated where they exist) with state and retirement dates. It is the one official table that maps every generation to its id. It is **not** used in this slice (O-2).

**LiteLLM** (same pinned URL as slice 5; 2,926,145 bytes today, up from 2,828,373 on 2026-10-14; 22 keys with `litellm_provider: "anthropic"`). Bare keys exist for both the dateless and the dated ids (`claude-sonnet-4-6`, `claude-sonnet-4-5-20250929`, also an alias key `claude-sonnet-4-5`). Each carries `input_cost_per_token`, `output_cost_per_token`, `cache_read_input_token_cost`, `cache_creation_input_token_cost`; `claude-sonnet-4-5*` carry `deprecation_date: 2026-11-30`. Retired Claude 4.0, 4.1 and 3.x ids are absent.

---

## 3. Design

### 3.1 One round, both providers (O-4)

One click reads OpenAI, Anthropic and LiteLLM **in parallel** and stores **one** `fetch` round holding every line from every provider that succeeded. The 60 s double-click guard stays per round.

- **Why one round, not a provider choice.** The user asked for the existing button to "also read" Anthropic. One round keeps one audit entry, one 60 s anchor, one status read and one table refresh. A provider choice would add a body field to a route whose strict empty body is today's proof that nothing can be supplied (SC-13 / RR-1).
- **Time budget unchanged.** Three fetches run in parallel under the same 10 s timeout and one retry; the handler is still designed to finish within 30 s under `maxDuration = 60`.

### 3.2 Partial failure

Each provider succeeds or fails on its own (MP-FR-12, RR-1):

| Case | Stored | Admin sees |
|---|---|---|
| Both providers `ok` | One round, both providers' lines | "OpenAI: N prices read …", "Anthropic: M prices read …" |
| One provider fails (`blocked`, `timeout`, `http_<n>`, `network_error`, `too_large`, `layout_changed`) | One round with the other provider's lines; the failed provider's outcome with zero lines | The failed line in words with the time, "Enter prices by hand", plus "Last successful check" and "Last failure" for that provider. The other provider's line as normal |
| Both fail | A zero-line round (allowed for `fetch` since `20261069`), both outcomes stored | Both failures in words; the 60 s anchor and "last failure" still work |
| LiteLLM fails | Lines from both providers, each with `cross_check_unavailable` | "LiteLLM cross-check unavailable; prices still loaded" |
| A line refused by the bounds | Not stored, supersedes nothing (slice 5 O-5); listed under its provider | "1 refused" in that provider's line |

The answer is 200 whenever the round is stored. A provider failure is in the summary, never an error status.

### 3.3 Anthropic adapter (`anthropicPricingAdapter.ts`, pure, deterministic, no LLM)

Page text in, `{ outcome, failedAnchor?, lines, needsManual, notFound, nameNotes, cacheListed }` out: the same result shape as the OpenAI adapter, plus `cacheListed` (3.3 cells).

**Pinned anchors.** Any one missing gives `layout_changed` with **zero lines** for Anthropic (RR-1):
- **B1** the whole line `## Model pricing`, exactly once.
- **B2** the first line starting with `|` after B1 is the header row, compared as a trimmed cell list, **exactly** the six cells in section 2; the next line is the separator (same cell count, each `:?-{3,}:?`). The table ends at the first line that does not start with `|`, so it can never run into "Cloud platform pricing", Fast mode or Batch. Only prose may stand between B1 and B2 (no other heading); a heading in between fails B2.
- **B3 (unit).** RR-1 requires the unit text to be pinned, and Anthropic puts it in each cell, not the header. Every cell of the **read** columns (`Base input tokens`, `Output tokens`) **and** of `Cache hits and refreshes` that starts with `$` must match `^[$][0-9]{1,6}([.][0-9]{1,9})? / MTok(<sup>[0-9]{1,2}</sup>)?$`. One `$` cell that does not (for example `$3 per million` or `$3 USD / MTok`) fails the whole table. This is a layout check on the column's unit, over all rows, not a price judgement (O-5).

**Read columns.** By name: `Model`, `Base input tokens`, `Output tokens`. `5m cache writes` and `1h cache writes` are never read. `Cache hits and refreshes` is read **only** to decide `cacheListed` (true when the row's cell is a price); its value is never stored (F-11, O-3).

**Cells.**
- A price cell is exactly `$<digits>[.<digits>] / MTok` with no footnote. The digits are kept as written (`$0.125 / MTok` gives `"0.125"`). No float at any step.
- A read cell carrying a footnote (`<sup>n</sup>`), `-`, an empty cell, or any other text sends the model to **needs manual entry** (`cell_not_single_price`, or `missing_price` for `-` and empty), with the cell text cut to 80 characters. Footnote text is never parsed: a footnote can change a price's meaning (Sonnet 5's footnote is exactly that), so the admin reads it.
- A wrong cell count on an in-coverage row gives `wrong_cell_count` (as SC-10).

**Model matching (generic; no per-model table).** A shared matcher, `modelCellMatcher.ts`, extracted from `matchModelCell` so both adapters use one implementation:
1. **Links to text (new, Anthropic option).** Every markdown link `[text](url)` in the model cell becomes `text`. The OpenAI adapter does not turn this option on, so its behaviour is byte-identical (its tests stay unedited).
2. Trim; drop **one** trailing parenthetical note (kept in `nameNotes`, for example "retired, except on Bedrock and Google Cloud"); lower case; spaces to hyphens.
3. Candidates: the text, and the text with dots turned into hyphens; deduped; each must pass `MODEL_ID_REGEX`.
4. **Exact match:** a candidate equal to a coverage id.
5. **Snapshot rule (new, Anthropic option, O-1; wording fixed per SC10-1).** A coverage id equal to `<candidate>-<8 digits>` also matches, **in union with** the exact matches (not a fallback): matches = exact ∪ snapshot. Anthropic documents dated ids as the pinned snapshot of the model named on the pricing page (section 2). The rule names a **format** (`-YYYYMMDD`, a regex constant in the adapter), never a model. `claude-opus-4` + snapshot matches `claude-opus-4-20250514` and cannot match `claude-opus-4-1-20250805` (`-1-` is not eight digits).
6. **Coverage first.** A row with no match is ignored before any cell is judged.
7. **Ambiguity stays strict (SC-10).** More than one match (two dated ids for one row, or the dateless id and a dated id both in coverage) sends every matched id to needs manual (`ambiguous_match`). The same id matched by two rows (Haiku 5.5's two prompt-length rows) gives `listed_twice`. Today's coverage has neither (T-0 re-checks).

**Notes are shown, not interpreted (O-6).** A "retired, except on …" note is kept in `nameNotes` and shown in the status. It does **not** set `retiring`: that flag blocks apply, and setting it from free text would be a keyword guess. `retiring` keeps coming from LiteLLM's `deprecation_date` (O-11 of slice 5).

**Output.** One token line per matched model: `provider: 'anthropic'`, `kind: 'token'`, `input_per_1m`, `output_per_1m`, **no** `cached_input_per_1m`, `source_url` = the human page, `checked_on` = today (UTC).

### 3.4 Round assembly (`fetchRound.ts`, made provider-generic)

- **Adapter registry** (`priceAdapters.ts`, pure): a typed record over the adapter providers. Per provider: the parse function, the human page URL (from `fetchSources.ts`) and `isInputOnly`. Keyed by `PriceProvider`, so `PROVIDER_FETCH_MODE` and the registry cannot disagree (a test pins that every `'adapter'` provider has an entry and no `'manual'` one has).
- `buildFetchRound` takes `results: { openai, anthropic }` (each a `FetchResult`), the LiteLLM result, and the coverage set split by provider. For each provider it runs the same steps as slice 5 (schema, `lineContextFor`, `evaluatePendingLine`, cross-check, refused list), with `crossCheckLine(list, provider, price)`.
- **`cached_input_listed` for Anthropic.** When the adapter reports `cacheListed` for a model, the fetch adds the existing flag `cached_input_listed` ("provider lists a cached-input price") to that line. It is informational, and it records on the line that cache prices exist and were deliberately not proposed. Merged with `orderedFlags`, like the cross-check flags.
- **Outcomes:** `openai` and `anthropic` each get an `AdapterOutcome` (outcome, fetched_at, duration, bytes, lines_stored, needs_manual, not_found, refused, name_notes; each list ≤ 50). `google` and `kimi` stay `manual_only`. `litellm` counts every verdict across both providers.
- **Cross-check, unchanged module.** `crossCheckLine` already takes the provider and compares only units both sides have. An Anthropic line has no cached unit, so LiteLLM's `cache_read_input_token_cost` is shown in the value text but never compared, and `cache_creation_input_token_cost` is not read at all. Lookup stays "bare key equal to the id, `litellm_provider === 'anthropic'`".

### 3.5 Sources (`fetchSources.ts`)

- New pinned constants: `ANTHROPIC_PRICING_MARKDOWN_URL = 'https://platform.claude.com/docs/en/about-claude/pricing.md'` (fetched) and `ANTHROPIC_PRICING_PAGE_URL = 'https://platform.claude.com/docs/en/about-claude/pricing'` (stored, never fetched).
- `PRICE_SOURCES` gains `anthropic`: `accept: 'text/markdown, text/plain'`, content types `text/markdown` or `text/plain`, cap 5 MB. Same `fetchLimited`: 10 s timer over headers and body, one retry on a network error or 5xx, `redirect: 'manual'`, `cache: 'no-store'`, only `User-Agent` and `Accept` sent, never throws. `text/html` is `blocked` (a Cloudflare challenge page lands here).
- **RR-8 ruling needed (O-7).** This is the third fixed outbound URL of the feature, on the provider's own documentation host.

### 3.6 Route and repository

**`POST /api/admin/model-pricing/fetch-runs`** (same file, same order):
- `Promise.allSettled` over three `fetchLimited` calls; coverage split per provider by the existing `provider:` key prefix, each filtered by `MODEL_ID_REGEX` (SA F-1 of slice 5, now for both).
- One log line per source (`openai`, `anthropic`, `litellm`), never the body. A failed anchor logs `{ provider, anchor }` at warn.
- Audit `AI_PRICE_FETCH_RUN` (already registered; **no new event, no `eventAudience` pin change**): `details` gains an `anthropic` block shaped like the `openai` block (outcome, lines stored, needs-manual / not-found / refused model ids; counts and ids only, no cell text). `manual_providers` becomes `['google', 'kimi']`.
- The 200 summary is unchanged in shape: `{ roundId, providerOutcomes, problems }`, where `problems` entries gain `provider` so the page can say which provider a refused line came from.

**`GET`**: per monitored source (`openai`, `anthropic`, `litellm`): last run, last `ok`, last failure. Seven small parallel reads (one latest plus two per source). `FetchStatus` gains `anthropic: SourceStatus`; `lastRunCounts` is filled for both adapter providers. When the latest round predates slice 10 (its `anthropic` is `manual_only`), Anthropic's `lastRun` reads "not checked yet", not a failure.

**Repository (`AiPriceProposalRepository`, additive):** `FetchOutcomeSource` adds `'anthropic'`; the JSON path for it is `provider_outcomes->anthropic->>outcome`; for `not_ok` on Anthropic the query adds `.neq(path, 'manual_only')`. Still no update or delete method, still no `.or()`.

### 3.7 UI and copy (`/admin/system-config`)

- **Button:** text unchanged, "Check provider prices". Busy label unchanged.
- **Status block (`ProviderPriceCheck.tsx`):** `openaiLine` becomes `providerLine(provider, status)`, used for OpenAI and Anthropic (one line each, each with its own "Last successful check" and "Last failure"). The manual line reads "Google and Kimi: manual entry for now." The needs-manual and not-found lists after a run are grouped by provider ("Anthropic: needs manual entry: …"). Name notes for Anthropic are shown in a small muted list ("Anthropic page notes: claude-opus-4-1-20250805: retired, except on Bedrock and Google Cloud"). The images line is unchanged (Anthropic has no image models).
- **`PRICE_REVIEW_NOTE`:** "Check provider prices reads OpenAI’s and Anthropic’s official pricing pages; Google and Kimi prices are entered by hand for now." The rest of the note is unchanged.
- **Help drawer (`page.tsx` line 154):** "Check provider prices reads OpenAI’s and Anthropic’s official pricing pages. For Google and Kimi, use Enter provider price …". Plus one sentence: "Anthropic’s cache prices are not read: we do not use Anthropic prompt caching, so nothing charges them."
- **"Last provider check" KPI (B-1):** shows the **older** of the two providers' last successful checks and names that provider when they differ ("Anthropic, 2026-10-18 11:31 UTC"). Red when either provider has never succeeded, or either is older than 90 days. Before the first slice 10 run, Anthropic has no success, so the KPI reads red "Anthropic never checked; use Check provider prices" until the button is pressed once.
- Strings in `priceReviewCopy.ts`; chips only from `StatusChip`; no number parsing in browser files (RC-8); types only from `fetchOutcomes` (`import type`, SC-14).
- The comparison table is unchanged: Anthropic rows already show input and output against the pending line, cached input "not compared", the cross-check words in the source cell.

### 3.8 No migration (O-8)

F-1 and F-2 show the function and tables already accept a two-provider round and every flag used. The `provider_outcomes` shape change is inside a JSON object the database only checks for "is an object". **No migration, no rollback, no checker.** Charging files are untouched.

---

## 4. Files

| File | Action | Reason |
|---|---|---|
| `lib/ai/pricing-research/anthropicPricingAdapter.ts` | create | 3.3 |
| `lib/ai/pricing-research/modelCellMatcher.ts` | create | Shared matcher (3.3 steps 1–7); `openaiPricingAdapter.ts` re-exports `matchModelCell` from it so its callers and tests are unchanged |
| `lib/ai/pricing-research/priceAdapters.ts` | create | Adapter registry (3.4) |
| `lib/ai/pricing-research/openaiPricingAdapter.ts` | modify | Uses the shared matcher with the slice 5 options; behaviour identical |
| `lib/ai/pricing-research/fetchRound.ts` | modify | Provider-generic loop; `cached_input_listed` from `cacheListed`; `problems[].provider` |
| `lib/ai/pricing-research/fetchOutcomes.ts` | modify | `anthropic` read as adapter or `manual_only`; `PROVIDER_FETCH_MODE.anthropic = 'adapter'`; `MonitoredSource` adds `anthropic`; `FetchStatus.anthropic`; `sourceStatus` counts for any adapter provider |
| `lib/ai/pricing-research/fetchSources.ts` | modify | Two Anthropic constants; `PRICE_SOURCES.anthropic` |
| `lib/ai/pricing-research/__fixtures__/anthropic-pricing-2026-10-18.md` | create | Trimmed capture (5.1) |
| `lib/ai/pricing-research/__fixtures__/litellm-anthropic-entries-2026-10-18.json` | create | Anthropic entries only, merged into the slice 5 LiteLLM fixture by the tests (5.1, O-9) |
| `lib/repositories/AiPriceProposalRepository.ts` | modify | `FetchOutcomeSource` adds `anthropic`; the `manual_only` exclusion (3.6) |
| `app/api/admin/model-pricing/fetch-runs/route.ts` | modify | Three sources, per-provider coverage, audit `anthropic` block, GET for three sources |
| `app/admin/system-config/components/ProviderPriceCheck.tsx` | modify | 3.7 |
| `app/admin/system-config/priceKpis.ts` | modify | B-1 |
| `app/admin/system-config/priceReviewCopy.ts`, `page.tsx` | modify | Copy (3.7) |
| Tests (5.2) | create / modify | — |
| `docs/requirements/AI_MODEL_PRICE_REVIEW_REQUIREMENT.md` | modify | Status line and Change History |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | none | No new route |

Not touched: `lib/ai/pricing.ts`, `lib/ai/providers/anthropicProvider.ts`, `lib/ai/imagePricing.ts`, `comparisonModel.ts` (`tokenCoverage` is already exported), every migration, `source.guard.test.ts`, `chargingUntouched.guard.test.ts` assertions, `livePriceWrites.guard.test.ts`.

---

## 5. Tests and CI

**All offline: no network in CI, no new job.** Every suite keeps the slice 5 `global.fetch` spy that fails the test if called (SC-16). Pure parser suites run in milliseconds; total added time is well under 1 s in the existing Jest job.

### 5.1 Fixtures

- **`anthropic-pricing-2026-10-18.md`**, about 90 lines, cut from a fresh capture at T-2 (re-dated if T-2 runs on a later day): the front matter; the intro; `## Model pricing` with the full 22-row table and its footnotes; the `## Cloud platform pricing` heading and first paragraph (proves the table ends before it); `### Fast mode pricing` with its table; `### Batch processing` with its table and the MTok bullets. Tool-use, web-fetch and the other sections are dropped, which removes all five backslash lines. The fixture keeps the page's curly apostrophes (UTF-8, no backslash), and a test asserts no backslash.
- **`litellm-anthropic-entries-2026-10-18.json`**: the bare Anthropic keys for the five current coverage ids plus `claude-sonnet-4-5` (alias key, to prove it is never used for a dated line), each trimmed to `litellm_provider`, the three cost fields and `deprecation_date`, plus one `bedrock/…` prefixed key (ignored). Tests merge it into the slice 5 fixture (112 keys), so the list passes the 100-key floor and the slice 5 fixture stays byte-identical.

### 5.2 Suites

| Suite | Cases |
|---|---|
| `anthropicPricingAdapter.test.ts` (new) | **Happy:** `claude-sonnet-4-6` gives `3` / `15`, `claude-opus-4-6` gives `5` / `25`; no line has `cached_input_per_1m`; `cacheListed` true for both. **Snapshot rule:** "Claude Sonnet 4.5" gives `claude-sonnet-4-5-20250929`; "Claude Opus 4" gives `claude-opus-4-20250514` and not `claude-opus-4-1-20250805`. **Link note:** "Claude Opus 4.1 ([retired, …](https://…))" matches `claude-opus-4-1-20250805`, note "retired, except on Bedrock and Google Cloud" in `nameNotes`, no `retiring` flag. **Not found:** `claude-3-5-haiku-20241022` (word order) and a retired 3.x id. **Negative controls:** Batch never read (`claude-sonnet-4-6` is never `1.50`); Fast mode never read; the cache-write columns never read (a test replaces their cells with garbage and the result is unchanged). **Manual:** a footnoted read cell (a coverage double for "Claude Sonnet 5") gives `cell_not_single_price` with the cell text; `-` output gives `missing_price`; a wrong cell count; Haiku 5.5's two rows give `listed_twice` when a coverage double names `claude-haiku-5-5`; two dated ids for one row, and dateless plus dated, give `ambiguous_match`. **Layout (zero lines each):** heading renamed; heading twice; a header cell renamed ("Cache hits & refreshes"); a column added; separator missing; a heading between B1 and the table; one read-column cell `$3 per MTok` (B3); one cache-hit cell `$0.30 USD / MTok` (B3). **Coverage first:** out-of-coverage rows with odd cells are ignored. **No float:** every price equals the cell digits. **No model literal** in the module (SC-15 guard below) |
| `modelCellMatcher.test.ts` (new) | Links to text only when the option is on; the OpenAI option set reproduces every slice 5 `matchModelCell` case; the snapshot rule only when on; the suffix must be exactly 8 digits; `MODEL_ID_REGEX` applied |
| `openaiPricingAdapter.test.ts` | **Unedited.** Passing unchanged proves the shared matcher did not change OpenAI |
| `litellmCrossCheck.test.ts` | Add: Anthropic agrees (`3e-7` read, but no cached unit compared); `deprecation_date 2026-11-30` gives `retiring`; retired id `not_listed`; an `anthropic` id with `litellm_provider: 'bedrock'` is `not_listed`; the alias key never answers for a dated id |
| `fetchSources.test.ts` | Add: the Anthropic source accepts `text/markdown`, refuses `text/html` as `blocked`, a 307 reads `http_307` (not followed); `PRICE_SOURCES` has exactly three entries |
| `fetchRound.test.ts` | Add: both providers ok (one line set, two outcomes); OpenAI blocked and Anthropic ok; Anthropic `layout_changed` and OpenAI ok; both fail (zero lines, both outcomes); LiteLLM down (every line `cross_check_unavailable`); an Anthropic line carries `cached_input_listed` and no cached price; `problems[].provider`; `provider_outcomes` passes its own schema. **Deliberate edits:** the slice 5 expectation `anthropic: { outcome: 'manual_only' }` becomes the adapter outcome (one comment line per edit) |
| `fetchOutcomes` (in `fetchRound.test.ts` or new `fetchOutcomes.test.ts`) | An old round (`anthropic: manual_only`) still parses; Anthropic `lastRun` reads "not checked yet" for it; a new round always writes the adapter shape; registry and `PROVIDER_FETCH_MODE` agree |
| Repository test | `latestFetchRoundByOutcome('anthropic', 'not_ok')` sends `.neq(path,'ok')` and `.neq(path,'manual_only')`; never `.or(` |
| `fetch-runs/__tests__/route.test.ts` | Add: three fetches; partial failures as 3.2; audit details carry the `anthropic` block and `manual_providers: ['google','kimi']`; GET returns `anthropic` status, last failure, and "not checked yet" after an old round. **Deliberate edits:** lines 253, 270, 408 (`manual_only`, the manual list) |
| `fetchSources.source.test.ts` | **Deliberate edit:** the pinned URL list gains the two Anthropic constants (five in total). `fetch(` still only in `fetchSources.ts`; no LLM import; no logger call names the body; fixtures contain no backslash; the SC-15 model-literal check now also scans `anthropicPricingAdapter.ts`, `modelCellMatcher.ts`, `priceAdapters.ts` |
| `providerPriceCheck.render.test.tsx` | Add: an Anthropic line in words; its last success and failure; "Google and Kimi: manual entry for now"; lists grouped by provider; page notes. **Deliberate edit:** the "Anthropic, Google and Kimi" expectation |
| `priceKpis.test.ts` | Add: the older provider wins and is named; red when Anthropic never succeeded; red when either is over 90 days |
| `pageLayout.render.test.tsx`, `KpiStrip.callers.pin.render.test.tsx` | Re-run; edit only if they pin the KPI or note text (T-0 lists them) |

Commands: `npx jest lib/ai/pricing-research app/api/admin/model-pricing app/admin/system-config app/admin/components/layout lib/repositories`, `npm run lint`, type check of the touched files (slice 5 D-10: a full `tsc --noEmit` runs out of heap on this machine), `npm run typecheck:bos-llm`.

---

## 6. Security

- **No SSRF.** The new URL is a code constant, the body schema stays an empty strict object, redirects are not followed.
- **Caps and timeouts** as slice 5: 5 MB, 10 s per attempt, at most one retry.
- **No secrets, no cookies.** The Cloudflare `__cf_bm` cookie is never stored or sent back; only `User-Agent` and `Accept` are sent.
- **Logging and audit.** No page body logged or audited; audit details hold counts and model ids only.
- **Writes.** Pending-only, through the service-role RPC that re-checks `admin_users` and never names the live tables (pinned since slice 3/5).
- **Admin route.** Unchanged: `requireAdmin` first.

---

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| K-1 | Anthropic changes the page layout (renamed column, unit, heading) | B1–B3 fail loudly with zero Anthropic lines; the status says so; a Pino warn names the anchor; OpenAI still loads; manual entry still works |
| K-2 | The parser reads the wrong column (for example a cache column shifts into "Output") | Columns read by name from an exact header; the cache-write negative control; LiteLLM compares input and output and flags over 5% (blocking at apply) |
| K-3 | The snapshot rule gives a dated id a price the provider no longer charges for that snapshot | Anthropic's page has one row per model, and its docs define the dated id as that model's pinned snapshot. LiteLLM compares the dated key independently. A dated id with two candidates goes to manual |
| K-4 | Cloudflare blocks the server (403 or an HTML challenge) | Classified `blocked`; no evasion; manual entry. Today's capture was a plain 200 |
| K-5 | A footnote or a two-tier row (Haiku 5.5) changes a price's meaning | A footnoted read cell and a twice-listed model go to manual with the cell text shown; footnotes are never parsed |
| K-6 | Someone later reads "cached input" for Anthropic as charged | No cached price is proposed for Anthropic; the flag `cached_input_listed` says the provider lists one; the help drawer says nothing charges it; the comparison keeps "not compared"; charging is untouched |
| K-7 | Old rounds (`anthropic: manual_only`) break the status read or count as failures | Read schema accepts both shapes; the repository excludes `manual_only` from Anthropic failures; tests for both |
| K-8 | Refactoring `fetchRound` / the matcher changes OpenAI behaviour | `openaiPricingAdapter.test.ts` unedited; OpenAI `fetchRound` cases unedited except the `anthropic` outcome key |
| K-9 | Retired Claude 4.0 / 4.1 models get pending "no change" lines | Correct (the price is still published). Their name note shows "retired, except on …"; nothing changes until someone applies a line |
| K-10 | The KPI turns red after deploy (Anthropic never checked) | Expected and explained in the manual check: one press of the button clears it |

---

## 8. Task list

- [x] ✅ **T-0** SA rules on O-1..O-10 (including the RR-8 ruling on the new URL, O-7); the user answers B-1. TL read-only production check: (a) active `ai_model_pricing` rows with `provider = 'anthropic'` (model names); (b) any Anthropic model named in the Business OS model settings (`system_settings_config`); (c) the five most recent `ai_price_proposals` rows with `source_kind = 'fetch'`, only `provider_outcomes->'anthropic'`, to confirm every stored round reads `manual_only`. **Stop rule:** if (a) or (b) holds an Anthropic id that is both dateless and has a dated twin in coverage (an `ambiguous_match` on the first run), report it before coding
- [x] ✅ **T-1** `git diff --stat` baseline; confirm no migration number is needed; list every test that pins `manual_only`, the manual-provider list, the URL list or the KPI/note copy (grep), and name each deliberate edit
- [x] ✅ **T-2** Re-capture the Anthropic page; cut `anthropic-pricing-<date>.md`; cut the LiteLLM Anthropic fragment; record bytes, lines and header in 12.1
- [x] ✅ **T-3** `modelCellMatcher.ts` and its tests; `openaiPricingAdapter.ts` switched to it; OpenAI suite green unedited
- [x] ✅ **T-4** `anthropicPricingAdapter.ts` and its tests
- [x] ✅ **T-5** `fetchSources.ts` (Anthropic source), `fetchOutcomes.ts`, `priceAdapters.ts`, `fetchRound.ts`, and their tests
- [x] ✅ **T-6** Repository change and test; route POST and GET, audit details; route tests
- [x] ✅ **T-7** `ProviderPriceCheck.tsx`, `priceKpis.ts`, copy and help drawer; render and KPI tests
- [x] ✅ **T-8** Source guards (URL list, SC-15 scan list); commands green; charging files, migrations, `source.guard`, `chargingUntouched.guard` assertions and `livePriceWrites.guard` unedited; `git diff --stat` reviewed
- [x] ✅ **T-9** Docs: requirement status and Change History; this workplan (12.1 notes and deviations)

---

## 9. Open questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| O-1 | **Dated ids.** The pricing page names models ("Claude Sonnet 4.5"); our stored ids for pre-4.6 models are dated (`claude-sonnet-4-5-20250929`). Accept the generic **snapshot rule**: when no exact match, a coverage id equal to `<normalised name>-<8 digits>` matches, still under SC-10's "more than one match means manual"? It names a format, not a model | **Yes.** Without it only 2 of the 13 Anthropic ids are ever read; with it 8 are, and the rest are correctly "not found". Applied to Anthropic only (an adapter option), so OpenAI is unchanged |
| O-2 | Alternative to O-1: also fetch Anthropic's official `model-deprecations.md` "Model status" table, which lists every generation's API id (dated where one exists), and map name to id from it. It would also give an official retiring signal | **Not now.** A fourth URL and a second parser to break, for the same mapping the format rule gives today. Revisit if the snapshot rule ever produces an ambiguity |
| O-3 | **Cache prices.** Store nothing for Anthropic's cache columns, and add the existing `cached_input_listed` flag when the page lists a cache-hit price? The alternative is to store the cache-hit price as `cached_input_per_1m` (already labelled "stored, not charged" at apply) | **Store nothing.** No Anthropic call uses caching (F-11), so a stored cache price would be a number nobody charges, and applying it would write a column nothing reads. The flag records that it exists. The charging-accuracy follow-up can add it when caching is turned on |
| O-4 | One round covering both providers, no provider choice (3.1)? | **Yes** |
| O-5 | B3 checks the unit form of every `$` cell in the read and cache-hit columns, including rows outside coverage. That is a layout check, not a price judgement, so SC-10's "coverage first" still holds for prices. Acceptable? | **Yes.** RR-1 requires a unit anchor, and Anthropic's unit lives only in the cells |
| O-6 | The "retired, except on …" note is shown but does **not** set `retiring` (a blocking flag)? | **Yes.** Keyword reading of free text is a guess; LiteLLM's date remains the source, and the note is visible |
| O-7 | **RR-8:** approve the new fixed outbound URL `https://platform.claude.com/docs/en/about-claude/pricing.md` (official host, already on the Anthropic allow-list), same limits as slice 5? | **Yes**; it is the source RR-1's survey named |
| O-8 | No migration (3.8): the round, the lines and the flags all fit the existing function and checks? | **Yes** (F-1, F-2) |
| O-9 | LiteLLM fixture: a small Anthropic fragment merged into the slice 5 fixture in tests, rather than a second full fixture? | **Yes.** Keeps the slice 5 fixture byte-identical and the new file small |
| O-10 | Extract the shared matcher (`modelCellMatcher.ts`) with per-adapter options, rather than copying `matchModelCell` into the Anthropic adapter? | **Yes**, one implementation of the RR-1 name rule; OpenAI's suite unedited proves no change |

---

## 10. Business questions

| # | Question | Recommendation |
|---|---|---|
| B-1 | The "Last provider check" tile shows one date. With two providers checked automatically, should it show the **older** of the two (and name that provider), so the tile turns red if either one has not been checked successfully for 90 days? Right after this release it will read red "Anthropic never checked" until someone presses the button once | **Yes, the older of the two.** A tile that only reflects OpenAI would look healthy while Anthropic's prices went unchecked |

**Decided by the user 2026-10-18 (via TL): B-1 "Oldest of the two".** The tile shows the older of OpenAI's and Anthropic's last successful checks and names that provider (red when either never succeeded or the one shown is over 90 days old). Implemented as the named policy function `decidingCheck` in `priceKpis.ts` (SC10-4); recorded in the requirement (Slice 10 decisions).

No other business question. For the record, as decided before: a fetched Anthropic reading replaces a hand-typed **pending** Anthropic price for the same model (BQ-A applies to every fetched provider); Google and Kimi stay manual (BQ-4).

---

## 11. Manual check (user, after deploy)

1. Open `/admin/system-config`. The "Last provider check" tile reads red "Anthropic never checked" (B-1).
2. Press **Check provider prices**. The status shows "OpenAI: N prices read …" and "Anthropic: M prices read …" (expected 8, with 5 not on the page, section 2), the LiteLLM counts, and "Google and Kimi: manual entry for now".
3. The table refreshes. Anthropic rows show the new provider price for input and output (no change expected today), cached input "not compared", and the cross-check words. `claude-sonnet-4-5-20250929` shows "provider is retiring this model".
4. The tile now shows a date.
5. No live price changed: the "In effect since" dates are unchanged.

---

## 12. Implementation notes and deviations

### 12.0 T-0 production facts (read-only, TL, 2026-10-18)

- **Active Anthropic price rows (13):** `claude-3-5-haiku-20241022`, `claude-3-5-sonnet-20241022`, `claude-3-haiku-20240307`, `claude-3-opus-20240229`, `claude-3-sonnet-20240229`, `claude-haiku-4-5-20251001`, `claude-opus-4-1-20250805`, `claude-opus-4-20250514`, `claude-opus-4-5-20251101`, `claude-opus-4-6`, `claude-sonnet-4-20250514`, `claude-sonnet-4-5-20250929`, `claude-sonnet-4-6`. No dateless id has a dated twin among active rows, so the **stop rule is not triggered**. (Retired dateless aliases `claude-3-haiku`, `-opus`, `-sonnet` exist but are retired.)
- **`system_settings_config`:** the rows mentioning claude or anthropic are agent-platform keys only (`agent_generation_*`, `agent_execution_ai_processing_*`, `orchestrator_fallback_model = claude-sonnet-4`). No Business OS area uses an Anthropic model.
- **Fetch rounds in production: 0** (no `source_kind = 'fetch'` proposal exists), so no stored `manual_only` Anthropic outcome yet. The SC10-2 / SC10-3 old-round compatibility is still built and tested (`fetchOutcomes.test.ts`, route GET "10" cases).
- **Branch:** `git fetch` + fast-forward to origin/main `5e9a59f1` at T-0 (no stash); merged again before hand-back (12.4).

### 12.1 T-2 capture record

- Fetched 2026-10-18 16:07 UTC with the product User-Agent and `Accept: text/markdown, text/plain`: `200`, `text/markdown; charset=utf-8`, `Content-Length: 50428`, 534 lines, no redirect, sha256 `d0dc6009…5b862`. Same size and header as the 11:31 capture in section 2.
- `## Model pricing` once; header exactly the six cells; separator `:---…`; 22 rows; every `$` cell of the read and cache-hit columns matches the B3 form. Rows today include Claude Fable 5.1 / 5, Mythos 5.1 / 5, Opus 5.5 / 5 / 4.8 / 4.7 / 4.6 / 4.5 / 4.1 / 4, Sonnet 5.5 / 5 / 4.6 / 4.5 / 4, Haiku 5.5 (two rows) / 4.5 / 3.5. Haiku 3.5 now carries "(retired, except on Google Cloud)" with a link.
- **Fixture** `anthropic-pricing-2026-10-18.md`: page lines 1–58 (front matter, intro, the full Model pricing table, footnotes, MTok bullets, the Cloud platform heading and first paragraph) plus lines 166–217 (Fast mode and Batch with their tables). 111 lines, 14,551 bytes, no backslash (the five backslash lines are at 261–376, dropped). UTF-8 with the page's curly apostrophes.
- **LiteLLM fragment** `litellm-anthropic-entries-2026-10-18.json`: from the 2,926,145-byte list fetched the same minute: the bare keys `claude-haiku-4-5-20251001`, `claude-opus-4-5-20251101`, `claude-opus-4-6`, `claude-sonnet-4-5` (alias), `claude-sonnet-4-5-20250929`, `claude-sonnet-4-6`, plus `bedrock/us-gov-east-1/anthropic.claude-haiku-4-5-20251001-v1:0` (ignored); each trimmed to `litellm_provider`, the four cost fields and `deprecation_date`. Merged into the slice 5 list (112 keys) in tests (O-9); the slice 5 fixture is byte-identical.
- **Expected first run against the 13 production ids:** 8 lines (as section 2), 5 not found (`claude-3-5-haiku-20241022`, `claude-3-5-sonnet-20241022`, `claude-3-haiku-20240307`, `claude-3-opus-20240229`, `claude-3-sonnet-20240229`), 0 needs manual, 3 page notes (Opus 4.1, Opus 4, Sonnet 4), LiteLLM 5 agree and 3 not listed, `retiring` on `claude-sonnet-4-5-20250929`.

### 12.2 SA conditions, where each landed

| # | Where |
|---|---|
| SC10-1 | `modelCellMatcher.ts` (`SNAPSHOT_SUFFIX` named regex, union of exact and snapshot matches); section 3.3 step 5 wording fixed; both ambiguity tests in `modelCellMatcher.test.ts` and `anthropicPricingAdapter.test.ts` |
| SC10-2 | `fetchOutcomes.ts`: `ProviderOutcomesSchema` is the WRITE schema (Anthropic adapter shape only), `StoredProviderOutcomesSchema` the READ schema (adapter or `manual_only`), used only by `outcomesOf`. `fetchOutcomes.test.ts` parses an old round with the read schema and proves the write schema refuses it. Browser files keep `import type` |
| SC10-3 | Repository: typed `Record<FetchOutcomeSource, string>` of paths and a `NOT_A_FAILURE` record; Anthropic `not_ok` = `.neq(path,'ok')` then `.neq(path,'manual_only')`; test asserts both, in order, and no `.or(`. `sourceStatus`: a `manual_only` run reads as `lastRun: null` ("not checked yet"), never a failure, never counted |
| SC10-4 | `decidingCheck` in `priceKpis.ts` is the one policy function; `lastCheckKpi` calls it. B-1 answered by the user before T-7 closed |
| SC10-5 | Requirement: RR-1 "Model matching" amendment, "RR-8 slice 10 ruling", "Slice 10 decisions" (B-1) and the BQ-A awareness note, status line and Change History |
| SC10-6 | `failedAnchors: Array<{ provider, anchor }>` (B1..B3 / A1..A4); the route logs one `{ provider, anchor }` warn each. Name notes are text only after link reduction, cut to `MAX_CELL_TEXT`. Header comments updated in `fetchSources.ts`, the route, `ProviderPriceCheck.tsx` and `fetchRound.ts` (`MANUAL_ONLY` now Google and Kimi) |
| SC10-7 | `priceAdapters.ts` keyed by `AdapterProvider` (derived from `PROVIDER_FETCH_MODE`), parser only; `fetchOutcomes.test.ts` pins adapter providers = registry = `PRICE_PAGE_URLS` keys, `PRICE_SOURCES` = adapters + `litellm`, no manual provider in either, `manualProviders()` = `['google', 'kimi']` |
| SC10-8 | `problems[].provider` is optional in `FetchRunSummary` (an older response has none); `priceFetchRun.ts` still requires only OpenAI's outcome (comment added); `ProviderPriceCheck.tsx` reads a provider's run lists only when they have the adapter shape. Render test "SC10-8" proves an older summary renders |
| SC10-9 | Only the named guard edits (12.3). `git diff` shows no change to migrations, charging files, `source.guard`, `chargingUntouched.guard`, `livePriceWrites.guard`, `comparisonModel.ts`, the OpenAI adapter suite or the slice 5 fixtures (12.4) |

### 12.3 Deliberate test edits (T-1 list)

Each carries a one-line "Slice 10 deliberate edit" comment in the file.

| File | Edit |
|---|---|
| `fetchRound.test.ts` | Input helper rewritten for the per-provider input (`providers`), keeping the slice 5 override names so case bodies are unedited; `anthropic` outcome `manual_only` → adapter `ok`; `failedAnchor` → `failedAnchors` (two lines); `problems` gains `provider` |
| `fetchSources.test.ts` | "exactly the two literal URLs" → three, Anthropic's asserted |
| `fetchSources.source.test.ts` | Pinned URL list 3 → 5 (the two Anthropic constants); SC-15 scan list + `anthropicPricingAdapter.ts`, `modelCellMatcher.ts`, `priceAdapters.ts`, `markdownTable.ts` |
| `fetch-runs/__tests__/route.test.ts` | `answer()` gains an Anthropic reply (default: the fixture; coverage `claude-x` is not on it); three fetched sources; Anthropic outcome; audit `anthropic` block and `manual_providers: ['google', 'kimi']`; three source log lines; coverage warning carries `provider`; layout warn message "Pricing page layout changed"; GET `buildFetchRound` input shape; `manualProviders`; six status reads |
| `providerPriceCheck.render.test.tsx` | Status double gains `anthropic`, manual list `['google', 'kimi']`; summary double's `anthropic` is an adapter outcome (type requires it); three "Last successful check" lines (was two); "Google and Kimi: manual entry for now."; after-run items prefixed "OpenAI: " |
| Not edited | `openaiPricingAdapter.test.ts`, `priceKpis.test.ts` existing cases (helper unchanged: a status without `anthropic` is OpenAI-only), `pageLayout.render.test.tsx`, `KpiStrip.callers.pin.render.test.tsx`, `source.guard.test.ts`, `chargingUntouched.guard.test.ts`, `livePriceWrites.guard.test.ts` |

### 12.4 Deviations from the plan

| # | Deviation | Why |
|---|---|---|
| D-1 | New file `markdownTable.ts`: `cellsOf`, `sameCells`, `nextNonBlank`, `tableRows`, `indicesOf` moved out of `openaiPricingAdapter.ts` unchanged | The Anthropic adapter needs the same table reader; one implementation, as O-10 for the matcher. The OpenAI suite passing unedited proves no change. Added to the SC-15 scan |
| D-2 | `priceAdapters.ts` holds the parser only. The stored page URLs are `PRICE_PAGE_URLS` in `fetchSources.ts`; `isInputOnly` is passed by the route (`isInputOnlyPricedModel(provider, …)`) | Keeps the registry pure (no `server-only` import, no charging-module import) and every URL in the one outbound-door file (SC10-7 "URL/parser config only") |
| D-3 | `FetchRoundInput` is `{ providers: { openai, anthropic }, litellm, … }` with per-provider `result`, `coverage`, `isInputOnly`, `sourceUrl` | Each provider has its own coverage and page; the workplan's `results` record plus split coverage, in one object |
| D-4 | `matchModelCell` stays exported from `openaiPricingAdapter.ts` (calls the shared `matchModelCellWith` with every option off) | Its callers and tests are unchanged |
| D-5 | A status from before slice 10 (no `anthropic` key, for example an old cached GET) is not drawn for Anthropic and is left out of the KPI, rather than shown red | It is "not reported", not "never checked". A real new status always carries `anthropic`, so B-1 applies in production. It also keeps `KpiStrip.callers.pin` and `pageLayout` unedited |
| D-6 | The KPI names the provider only when the two checks differ ("Anthropic, 2026-10-01 12:00 UTC"); one click reads both, so the usual value is unnamed. "Never checked" names the provider in the sub-line ("Anthropic never checked; use Check provider prices") | B-1's "names that provider" is meaningful only when they differ (section 3.7 said the same) |
| D-7 | Page notes are listed for Anthropic only (`NOTE_PROVIDERS`); OpenAI's notes (context-length labels) stay stored but not listed | As 3.7; avoids changing the OpenAI status block |
| D-8 | `fetchOutcomes.test.ts` is a new file | 5.2 allowed either |
| D-9 | New copy word `PRICE_CHECK_WORDS.pageNotes` ("page notes") | For the notes list |

### 12.5 Test and check results

| Check | Result |
|---|---|
| `npx jest lib/ai/pricing-research` | 23 suites; 573 passed, 6 failed: the 6 known local-only CRLF cases in `openaiPricingAdapter.test.ts` (the fixture is checked out CRLF on this machine, so `replaceOnce` finds no LF-only anchor; green in CI). That suite is **unedited** (SC10-10) |
| `npx jest app/api/admin/model-pricing/fetch-runs` | 38 passed |
| `npx jest lib/repositories/__tests__/AiPriceProposalRepository` | 2 suites, 20 passed |
| `npx jest app/admin/system-config app/admin/components/layout` | 944 tests; every slice 10 suite green. Under full-machine load a few long render cases time out at random (a different set each run: `pageLayout`, `priceTable`, `AdminConfirmDialog`, page wiring); each passes alone (`pageLayout` 13/13, `priceTable` 21/21) |
| **Final combined run** after the hand-back fetch (origin/main `5e9a59f1`, nothing new): `npx jest lib/ai/pricing-research app/api/admin/model-pricing lib/repositories/__tests__/AiPriceProposalRepository app/admin/system-config` | 44 suites, 924 tests: 918 passed, 6 failed = the same 6 known CRLF cases; no other failure |
| `npm run test:authz-guard` | 2 suites, 203 passed |
| `tsc --noEmit` on the touched source files (temporary scoped tsconfig, removed) | 0 errors. Test files are type-checked by ts-jest when they run |
| `eslint` on every changed file | 0 errors; 10 warnings, all in the untouched `priceHistory.qa.test.ts` |
| T-8 protected files | `git diff --name-only HEAD` over `supabase/`, `lib/ai/pricing.ts`, `lib/ai/providers/`, `lib/ai/imagePricing.ts`, `comparisonModel.ts`, `chargingUntouched.guard`, `livePriceWrites.guard`, every `source.guard.test.ts`, `openaiPricingAdapter.test.ts` and both slice 5 fixtures: **empty** |

---

## SA Review Notes

**Reviewed by SA — 2026-10-18** (against origin/main `399070d4` in this worktree)
**Status:** ✅ APPROVED WITH CONDITIONS (SC10-1..SC10-9). Implementation may start once T-0 is clean; conditions are folded in during T-3..T-9, not before.

### Claims verified against the code

| Claim | Verified | Evidence |
|---|---|---|
| F-1 mixed-provider round, no migration | ✅ | `20261069`: lines are a JSON array, `provider` read per line, duplicate key is `provider|model|kind|size|quality`, fetch limit 0..200, zero-line round needs only `jsonb_typeof(provider_outcomes) = 'object'`; supersede is per provider + unit. `20261066` outcomes CHECK is "fetch → NULL or object" |
| F-2 flags | ✅ | `ai_price_proposal_lines_flags_known` already lists `cached_input_listed`, `retiring`, `cross_check_*`, `new_model`, `large_move`, `above_conservative_rate` |
| F-3 / F-4 | ✅ | `ProviderOutcomesSchema` is `.strict()` with `anthropic: ManualOnlySchema`, used for both write (`fetchRound.ts`) and read (`outcomesOf`). Repository path is a two-way ternary with `.eq` / `.neq`, no `.or()` |
| F-8 matcher | ✅ | `TRAILING_NOTE` refuses `(`/`)` inside the note, so link-to-text must run first; after it, "Claude Opus 4.1 (retired, …)" → `claude-opus-4.1` / `claude-opus-4-1` |
| F-9 coverage | ✅ | `FALLBACK_PRICING.anthropic` in `lib/ai/pricing.ts` holds exactly the 13 ids listed |
| F-11 cache never charged | ✅ | `anthropicProvider.ts` calls `calculateCostSync('anthropic', model, input_tokens, output_tokens)` (two sites); `calculateCostWithCachedSync` has one caller, `openaiProvider.ts`; `cache_control` appears nowhere in `lib/`, `app/`, `components/` |
| Cross-check | ✅ | `crossCheckLine` compares only units both sides have (`cached_input_per_1m` undefined → shown, not compared), rejects a key whose `litellm_provider` differs, `deprecation_date` present → `retiring` |
| No model literal | ✅ (by design) | Display name → id is the generic lowercase/hyphen rule plus a format suffix; nothing names a model. SC-15 scan extended to the three new files |
| Source (RR-8) | ✅ re-checked by SA today | Product User-Agent + `Accept: text/markdown, text/plain` → `200`, `text/markdown; charset=utf-8`, `Content-Length: 50428`, no redirect. `## Model pricing` once, header row exactly the six cells in section 2, separator `:---…`, 22 rows; cells match the B3 form |
| No added CI time | ✅ | Pure parser + injected-fetch tests in the existing Jest job, `global.fetch` spy kept, two small dated fixtures, no new job or script |
| Logging | ✅ | `console.*` count 0 in every file the slice touches. `anthropicProvider.ts` (7 calls) is correctly **not** touched, so § Logging does not trigger |

### Rulings on O-1..O-10

| # | Ruling |
|---|---|
| O-1 | **Approved, Anthropic option only, as an amendment of RR-1.** RR-1 says a normalised name "must match a coverage id **exactly**"; the snapshot suffix is a documented provider id *format* (`-YYYYMMDD`, Anthropic's own definition of a pinned snapshot), not a model table, so CLAUDE.md rule 5 holds. Bound by SC10-1 (matching semantics) and SC10-5 (requirement amendment) |
| O-2 | **Agreed: not now.** No fourth URL. Revisit only if the snapshot rule produces an `ambiguous_match` in practice |
| O-3 | **Agreed: store nothing.** Verified that nothing charges an Anthropic cache rate. Adding `cached_input_listed` with no value is truthful to its label ("provider lists a cached-input price"). When Anthropic caching is ever turned on, the charging change and the cached proposal ship together in one reviewed slice |
| O-4 | **Approved.** One round, no provider choice; the strict empty body stays the SSRF proof |
| O-5 | **Approved.** B3 is a unit anchor across all rows of the read columns and the cache-hit column; failing loud on a unit change in a column we use for `cacheListed` is the RR-1 posture. Prices are still judged coverage-first |
| O-6 | **Approved.** Notes are shown, never interpreted; `retiring` stays LiteLLM-only |
| O-7 | **RR-8 ruling: APPROVED.** `https://platform.claude.com/docs/en/about-claude/pricing.md` is added as the third fixed outbound URL of this feature, under exactly the slice 5 shape: code constant in `fetchSources.ts` only, `redirect: 'manual'` (any 3xx is `http_3xx`, never followed), only `User-Agent` + `Accept` sent, no cookie stored or replayed, 10 s timer over headers and body, one retry on network error / 5xx, 5 MB cap, `text/html` → `blocked`, body never logged or audited. The stored `source_url` is the human page on the existing allow-listed host. This approval covers this URL for this feature only (RR-8); `docs.anthropic.com` (redirects) and the deprecations page (O-2) are **not** approved |
| O-8 | **Agreed: no migration.** Verified F-1/F-2 above |
| O-9 | **Approved.** Merge in a test helper; the slice 5 fixture stays byte-identical; merged list must still clear `LITELLM_MIN_KEYS` |
| O-10 | **Approved.** One matcher, options default **off**, OpenAI passes the slice 5 option set; `openaiPricingAdapter.test.ts` unedited is the proof |

### Conditions

1. **SC10-1 — Matching semantics are a union, not a fallback (High).** Section 3.3 step 5 says the snapshot rule runs "when no candidate matches exactly", but step 7 and the 5.2 tests expect "dateless plus dated in coverage" to give `ambiguous_match`. Under a fallback, the dated id would silently become `not_found` instead. Implement: matches = exact matches ∪ snapshot matches (snapshot = coverage id equal to `<candidate>-` + exactly 8 digits, checked by a named regex constant on the suffix); more than one → `ambiguous_match` for every matched id. Fix the wording of step 5 to match, and keep both ambiguity tests.
2. **SC10-2 — Separate write and read schemas (High).** Today one strict schema guards both directions. Widening `anthropic` to `AdapterOutcome | manual_only` on that one object would let a regression write `manual_only` again and still pass. Keep a write schema (`anthropic: AdapterOutcomeSchema`) used by `buildFetchRound`, and a read schema (`anthropic` = adapter **or** `manual_only`) used only by `outcomesOf` / the status read. Types for the browser stay `import type`. A test parses an old stored round with the read schema and proves the write schema refuses it.
3. **SC10-3 — Repository filter (Medium).** Replace the two-way ternary with a typed `Record<FetchOutcomeSource, string>` of JSON paths. Anthropic `not_ok` = `.neq(path, 'ok')` **chained with** `.neq(path, 'manual_only')` (an AND; still select-only, still no `.or()`). The repository test asserts both calls and no `.or(`. `sourceStatus` must render a `manual_only` latest run as "not checked yet", never as a failure, and never count it in `lastRunCounts`.
4. **SC10-4 — B-1 designed for either answer (Medium).** `lastCheckKpi` takes the adapter providers' `SourceStatus` values and reduces them through one small, named policy function. The workplan's "older of the two, name it, red if either never/over 90 days" is the default implementation; if the user answers otherwise (for example "newest" or "OpenAI only"), only that function and its tests change. Do not merge with a policy the user has not confirmed: TL records the B-1 answer in the workplan and the requirement before T-7 is closed.
5. **SC10-5 — Requirement amendment (Medium).** Splice into the requirement, under RR-1 "Model matching": the SA 2026-10-18 slice 10 amendment (markdown links reduced to their text before the note rule; the per-adapter dated-snapshot suffix with SC10-1 semantics; OpenAI unchanged), and the O-7 RR-8 ruling naming the URL. Plus the status line and Change History as planned.
6. **SC10-6 — Per-provider failure reporting (Medium).** `failedAnchor` becomes per provider (Anthropic anchors `B1`..`B3`, OpenAI `A1`..`A4`); the route logs one `{ provider, anchor }` warn per failed provider. Name notes are stored after link reduction (text only, no URL) and cut to `MAX_CELL_TEXT`. Update the header comments that say "exactly two fixed public URLs" / "Anthropic … manual entry" (`fetchSources.ts`, the route, `ProviderPriceCheck.tsx`, `fetchRound.ts` `MANUAL_ONLY` comment).
7. **SC10-7 — Registry and mode cannot drift (Low).** `priceAdapters.ts` is keyed by `PriceProvider`; a test pins: every `'adapter'` provider in `PROVIDER_FETCH_MODE` has a registry entry and a `PRICE_SOURCES` entry, no `'manual'` one has, and `manualProviders()` is `['google', 'kimi']`. The registry holds provider → URL/parser config only, never a model name (RR-1).
8. **SC10-8 — Summary shape (Low).** `problems[].provider` is additive; update the client reader (`priceFetchRun.ts`) and its test so an older cached response without the field still renders.
9. **SC10-9 — Guards unchanged except the named edits (Low).** Only deliberate edits: the pinned URL list (three → five, in `fetchSources.ts` only), the SC-15 scan list (+ `anthropicPricingAdapter.ts`, `modelCellMatcher.ts`, `priceAdapters.ts`), the `manual_only` / manual-list / copy expectations listed in T-1. `source.guard`, `chargingUntouched.guard` assertions, `livePriceWrites.guard`, every migration and every charging file stay unedited; `git diff --stat` at T-8 proves it.

### Awareness (no action required)

- **BQ-A side effect.** A fetched Anthropic line has no cached price, so it supersedes a hand-typed pending Anthropic line that carried one; the cached value leaves the pending area. Correct under O-3 (nothing charges it), but say so in the requirement note so nobody reads it as data loss.
- `claude-sonnet-4-5-20250929` will arrive with the blocking `retiring` flag (LiteLLM `deprecation_date`). Expected; it needs an override reason to apply.
- The retired 4.0 / 4.1 rows will produce "no change" pending lines; correct (K-9).

### Approval
[x] Workplan approved with conditions SC10-1..SC10-9 — proceed to implementation after T-0 (TL production read, stop rule) and with B-1 answered before T-7 closes

### Code review

**Code Review by SA — 2026-10-18** (uncommitted worktree on `5e9a59f1`)
**Status:** ✅ Code Approved

**SC10 conditions**

| # | Met | Evidence |
|---|---|---|
| SC10-1 | ✅ | `modelCellMatcher.ts`: `matches` = exact, then dated ids pushed in union (`SNAPSHOT_SUFFIX = /^-[0-9]{8}$/` on the remainder after `<candidate>`); `-1-20250805` cannot pass. Both ambiguity cases tested in the matcher and adapter suites |
| SC10-2 | ✅ | `ProviderOutcomesSchema` (write) has `anthropic: AdapterOutcomeSchema`; `StoredProviderOutcomesSchema` (read) the union, used only by `outcomesOf`. `fetchOutcomes.test.ts` proves the write schema refuses an old round |
| SC10-3 | ✅ | `OUTCOME_PATHS` / `NOT_A_FAILURE` typed records; Anthropic `not_ok` = `.neq(ok)` then `.neq(manual_only)`, no `.or(`. `runOf` returns null for a `manual_only` round; `lastRunCounts` only from an adapter-shaped outcome |
| SC10-4 | ✅ | `decidingCheck` is the one policy function; B-1 recorded in workplan §10 and the requirement |
| SC10-5 | ✅ | Requirement: RR-1 amendment, RR-8 slice 10 ruling, slice 10 decisions, BQ-A awareness, status and Change History |
| SC10-6 | ✅ | `failedAnchors[]` per provider, one `{ provider, anchor }` warn each; notes are post-link-reduction text cut to `MAX_CELL_TEXT`; header comments updated in all four files |
| SC10-7 | ✅ | `AdapterProvider` derived from `PROVIDER_FETCH_MODE`; registry, `PRICE_SOURCES` and `PRICE_PAGE_URLS` are mapped types over it (compile time), plus the run-time pin |
| SC10-8 | ✅ | `problems[].provider` optional; `priceFetchRun.ts` still requires only OpenAI; `adapterOutcomeOf` in the component skips a non-adapter shape |
| SC10-9 | ✅ | `git diff --name-only HEAD` over `supabase/`, `lib/ai/pricing.ts`, `lib/ai/providers/`, `imagePricing.ts`, `comparisonModel.ts`, every `*guard.test.ts`, `openaiPricingAdapter.test.ts` and tracked `__fixtures__/`: empty. T-8 holds |

**Specific checks**

- **D-1 verbatim move: verified.** The five removed helpers (`cellsOf`, `sameCells`, `nextNonBlank`, `tableRows`, `indicesOf`) and `SEPARATOR_CELL` are byte-identical in `markdownTable.ts` apart from the added `export` and two doc comments. The old `matchModelCell` body equals `matchModelCellWith` with both options off (link reduction skipped, snapshot block skipped, same `TRAILING_NOTE`, same candidate order). The OpenAI adapter imports only what it still uses.
- **OpenAI suite unedited, behaviour unchanged.** Not in the diff. Run by SA: the only failures are the 6 known CRLF anchor cases (`openai-pricing-2026-10-14.md` has CR on all 217 lines in this checkout); every other OpenAI case passes.
- **Deliberate test edits (12.3): each justified, none weakens a pin.** Every removed assertion is replaced by an equal-or-stronger one with a "Slice 10 deliberate edit" comment: `manual_only` → adapter outcome (`toMatchObject` on outcome, lines, not_found), `failedAnchor` → exact `failedAnchors` arrays, URL pin 2 → 3 fetched (plus exact Anthropic URL, page URL and 5 MB cap), source-guard URL list 3 → 5 and SC-15 scan + 4 files, manual list → `['google','kimi']`, render counts 2 → 3. The `fetchRound` helper keeps slice 5 case bodies unedited and gives Anthropic empty coverage, so the slice 5 LiteLLM counts (agrees 3) still pin exactly.
- **RR-8 on the new URL: met.** Same `fetchLimited` (unchanged): `redirect: 'manual'`, only `User-Agent` + `Accept`, `cache: 'no-store'`, 10 s timer over headers and body, one retry on network error / 5xx, `maxBytes` 5 MB (pinned in test), `text/html` → `blocked` (tested for Anthropic). `logSource` logs outcome/status/duration/bytes/attempts/count only; the audit `anthropic` block is outcome, counts and model ids. Body never logged or audited.
- **Rule 5 (no model lists).** Grep of the four new modules for `claude-|sonnet|opus|haiku|gpt-`: none. The snapshot rule names a format only.
- **D-5 vs B-1: acceptable.** The route always returns `anthropic` (required on `FetchStatus`); a status without the key exists only in old-server/new-client skew or test doubles. With 0 fetch rounds in production, the first post-deploy GET returns `anthropic.lastOkAt = null` and the tile is red "Anthropic never checked; …" exactly as B-1 says (K-15 pins it). An old stored `manual_only` round would also read `lastOkAt = null` → red, so B-1 holds there too.
- **Changed log message** ("OpenAI pricing page layout changed" → "Pricing page layout changed", provider in context): no reference anywhere in the repo outside the route test (grepped `docs/`, `docs/runbooks/`, workflows, config). No alert keyed on it.
- **Pino only.** `console.*` count 0 across every changed and new source file. No entitlements import.
- **Audit `lines_stored` per provider** maps `stored.lines[].lineIndex - 1` into `submitLines`; verified the RPC's `line_index` is `WITH ORDINALITY` (1-based) with one row per stored line, so the split is exact.
- **No added CI time.** Pure parsers, injected fetch, `forbidRealNetwork` kept, two small fixtures, no new job.
- **Tests run by SA:** `lib/ai/pricing-research`, the `fetch-runs` route, both repository suites, `priceKpis`, `providerPriceCheck.render`: all pass except the 6 known CRLF cases.

**Rulings on deviations**

| # | Ruling |
|---|---|
| D-1 | ✅ Accepted (verbatim, see above) |
| D-2 | ✅ Accepted: keeps the registry pure and every URL in the one outbound-door file |
| D-3 | ✅ Accepted |
| D-4 | ✅ Accepted |
| D-5 | ✅ Accepted (see above) |
| D-6 | ✅ Accepted: matches §3.7 and B-1 |
| D-7 | ✅ Accepted: OpenAI notes are context-length labels; listing them would be noise |
| D-8 | ✅ Accepted |
| D-9 | ✅ Accepted |

### Code Review Comments
None blocking.

### Optimisation Suggestions
- `fetchRound.ts` `const parts = {} as Record<AdapterProvider, ProviderPart>` is a cast filled by the loop; any alternative still needs a cast, so leave it. Low.
- `ProviderPriceCheck.tsx` `ADAPTER_ORDER` repeats the adapter list in the browser; justified (SC-14 forbids a value import from `fetchOutcomes`), and a third adapter would surface in the render test. Low.
- Awareness: a model-cell link whose URL contains `(` `)` is not reduced, so that row fails the note rule and its model reads "not found" (fails safe, visible). The two chained `.neq` on one JSON path are standard PostgREST AND semantics but have not run against the live DB (0 rounds); the §11 manual check (status after the first press) covers it.

### Code Approved for QA: Yes

## QA Testing Report

**QA — 2026-10-18**
**Test mode:** full
**Strategy used:** A (Jest unit tests: adapter, matcher, schemas, KPI) + B (Jest route and repository tests with mocked clients and an injected fetch; no network), plus code reading for the edge cases. No browser check: render tests cover the UI change, and the section 11 manual check is owed after deploy.
**Focus:** price-check parser and matching, round assembly, api, schema, security (fetch limits), ui (KPI)
**Skipped:** the live fetch and the browser check (CI has no network; section 11 covers both after deploy)
**Input source:** prompt keywords (TL brief)

### Suites run (once each, uncommitted worktree)

| Command | Result |
|---|---|
| `npx jest lib/ai/pricing-research` | 23 suites; 573 passed, 6 failed. The 6 are the known local-only CRLF cases in `openaiPricingAdapter.test.ts` (A2, A3 x2, A4 x2, SA F-5), all in "a missing anchor fails OpenAI". That suite is unedited. No other failure |
| `npx jest app/api/admin/model-pricing` | 7 suites, 132 passed |
| `npx jest lib/repositories/__tests__/AiPriceProposalRepository` | 2 suites, 20 passed |
| `npx jest app/admin/system-config` | 12 suites, 193 passed. Nothing timed out, so no suite needed a solo re-run |
| `npm run test:authz-guard` | 2 suites, 203 passed |
| QA addition `anthropicPricingAdapter.qa.test.ts` (new, tests only), run with `fetchSources.source.test.ts` | 11/11 QA cases pass; the source guard stays green; eslint clean |

### Test Coverage

| Item | Tested? | Result | Evidence |
|---|---|---|---|
| Parser vs fixture: 8 of our 13 ids matched, digits as written | ✅ | PASS | `anthropicPricingAdapter.test.ts` "reads the Model pricing table…" (the exact 8-line list) |
| 5 not on the page (four retired 3.x + Haiku 3.5 word order) | ✅ | PASS | "a coverage model the page does not yield is not found" |
| 3 page notes shown (Opus 4.1, Opus 4, Sonnet 4), text only, never set `retiring` | ✅ | PASS | "a linked note is kept as text only…"; `fetchRound.test.ts` "a page note never sets it"; render test for the Anthropic page notes |
| Footnoted `$x / MTok`, `-`, empty or other text → manual | ✅ | PASS | "a footnoted read cell" (`cell_not_single_price` with `$2 / MTok<sup>3</sup>`); "a '-' output and an empty input" (`missing_price`); wrong cell count |
| Layout anchors B1/B2/B3 fail → zero lines + `layout_changed`, per provider | ✅ | PASS | 8 `it.each` anchor cases (exact empty result + anchor); `fetchRound` "Anthropic layout changed, OpenAI ok"; route "logs its anchor; OpenAI still loads" |
| Matching: exact ∪ dated suffix; a dateless and dated twin → `ambiguous_match`, never silent | ✅ | PASS | `modelCellMatcher.test.ts` cases for the union, two dated ids and the 8-digit suffix; adapter "dateless and dated both in coverage" |
| OpenAI matching unchanged | ✅ | PASS | `openaiPricingAdapter.test.ts` unedited (only the 6 known CRLF failures); matcher "OpenAI option set is the slice 5 rule" |
| No Anthropic cache price proposed; `cached_input_listed` flag only | ✅ | PASS | adapter "never proposes a cache price"; `fetchRound` "an Anthropic line: … no cached price, `cached_input_listed`"; `PRICE_ADAPTERS.anthropic` passes coverage only |
| One round, both providers | ✅ | PASS | `fetchRound` "both ok: one line set…"; route "both providers ok: one round… audit names each provider" |
| Partial failure: one fails → the other's lines stored; both fail → empty round recorded (200) | ✅ | PASS | `fetchRound` and route: "OpenAI blocked, Anthropic ok"; "both fail: a zero-line round, 200"; LiteLLM down → `cross_check_unavailable` |
| Old-round compatibility: the write schema refuses a stored `manual_only`, the read schema accepts it | ✅ | PASS | `fetchOutcomes.test.ts` SC10-2 cases; `fetchRound.ts` writes through `ProviderOutcomesSchema` (write); `outcomesOf` reads through `StoredProviderOutcomesSchema` |
| `manual_only` never counted as a failure; `.neq` chained, never `.or()` | ✅ | PASS | repository test (two `.neq` in order, no `.or(`); `fetchOutcomes.test.ts` "not checked yet, never a failure"; route GET after an old round |
| KPI per B-1, incl. "Anthropic never checked" | ✅ | PASS | `priceKpis.test.ts` K-13..K-17: the older check is named; never checked → red, naming Anthropic; either over 90 days → red; an unreadable time counts as oldest. D-5/D-6 behave as documented |
| `claude-sonnet-4-5-20250929` gets `retiring` from LiteLLM (needs an override at apply) | ✅ | PASS | `litellmCrossCheck.test.ts` "a deprecation date gives retiring"; `fetchRound` "LiteLLM deprecation date gives retiring" |
| RR-8 fetch limits: redirects not followed, 5 MB cap, HTML → blocked, timeout, body not logged | ✅ | PASS | `fetchSources.test.ts` Anthropic block: headers, `redirect: 'manual'`, `no-store`, `text/html` → `blocked`, 307 → `http_307` after one call; 5 MB cap pinned. Timeout, cap and retry are covered by the slice 5 generic `fetchLimited` cases (same code path). `fetchSources.source.test.ts`: "no logger call names the body", `fetch(` only in `fetchSources.ts`. The route logs counts only |

### Edge cases (code reading, pinned by `anthropicPricingAdapter.qa.test.ts`)

| Edge | Result |
|---|---|
| Decimal exactness of `$0.80`, `$15`, `$1.25` | PASS: `"0.80"`, `"15"`, `"1.25"`, exactly as written (regex capture, no number conversion). The fixture's Haiku 3.5 row reads `"0.80"` |
| Note longer than 80 characters | PASS: cut to `MAX_CELL_TEXT` (`anthropicPricingAdapter.ts:287`), URL removed, still passes the strict `AdapterOutcomeSchema`. No test covered this before. An uncut note would make `ProviderOutcomesSchema.parse` throw and lose the whole round, so QA added the case |
| Read cell text longer than 80 characters | PASS: cut (`anthropicPricingAdapter.ts:198`), storable. QA added this case for the same reason |
| Extra ASCII spaces in the model cell | PASS: matches |
| Non-breaking space (U+00A0) inside the model name | Fails safe: no match. The model reads "not on the provider page", never a wrong price. Edge case 1 below |
| A link in the model cell (`[Claude Haiku 4.5](url)`) | PASS: reduced to its text, matches (Dev's `modelCellMatcher.test.ts`) |
| A link whose URL contains `(` `)` | Fails safe: the link is not reduced and the note rule cannot drop it, so the model reads "not found". Edge case 2 below |
| Rows for models we do not cover (garbage model cell, non-price read cell) | PASS: ignored before any cell is judged; empty coverage gives an empty `ok` result |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. Each added suite runs in well under a second; no new CI job.

#### Edge Cases (nice to fix)
1. **Non-ASCII whitespace in a model cell reads "not found".** `modelCellMatcher.ts:54` splits on `' '` only, so a non-breaking space or a tab inside a name gives a candidate that fails `MODEL_ID_REGEX`. It fails safe: the admin sees "Not on the provider page" and enters the price by hand. The live page uses plain spaces today. Severity: Low. One option is to split on `/\s+/` behind the Anthropic option. The QA test pins the current behaviour, so any change will be deliberate.
2. **A markdown link whose URL contains parentheses is not reduced.** `MARKDOWN_LINK` (`modelCellMatcher.ts:26`) refuses `(` `)` in the URL, so a note holding such a link leaves the model unmatched ("not found"). It fails safe, and today's page has no such link. SA noted the same. Severity: Low.
3. **Bare URLs in a plain-text note are not stripped.** Only markdown links are reduced, so a note like "(see https://…)" would be shown with its URL. React escapes it as text and it is cut to 80 characters, so this is not a security issue. Severity: Low.
4. **B3 checks the whole page, by design (SA O-5).** A single `$` cell in a new unit form fails every Anthropic line, even when it is in a row we do not cover. SA accepted this. Recorded so nobody mistakes a `layout_changed` from that cause for a parser bug.

### Test Outputs / Logs

```text
lib/ai/pricing-research            Tests: 6 failed (known CRLF, openaiPricingAdapter.test.ts), 573 passed, 579 total
app/api/admin/model-pricing        Tests: 132 passed, 132 total
AiPriceProposalRepository*         Tests: 20 passed, 20 total
app/admin/system-config            Tests: 193 passed, 193 total
npm run test:authz-guard           Tests: 203 passed, 203 total
anthropicPricingAdapter.qa.test.ts Tests: 11 passed, 11 total
```

### Final Status
- [x] All acceptance criteria pass: **Ready for commit**. No High or Medium issue is open; the 4 Low edge cases all fail safe. QA added one test file, `lib/ai/pricing-research/__tests__/anthropicPricingAdapter.qa.test.ts`, to be committed with the slice
- [ ] Issues found — Dev must address before commit

## Commit Info

[RM will populate this section]

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-18 | Workplan written | Slice 10 (Anthropic adapter) on `feature/ai-model-price-review-slice10` off `399070d4`: one round for both providers, deterministic Anthropic adapter with anchors B1–B3, shared name matcher with a generic dated-snapshot rule, no Anthropic cache price proposed (not charged today), per-provider status and KPI, no migration. Sources captured 2026-10-18. Open questions O-1..O-10 for SA (RR-8 ruling on the new URL), business question B-1. No code |
| 2026-10-18 | Code complete | SA conditions SC10-1..SC10-9 folded in (12.2); user decision B-1 "Oldest of the two"; T-0 production facts recorded (12.0, no stop); fixtures cut from a 16:07 UTC re-capture (12.1); deliberate test edits listed (12.3); deviations D-1..D-9 (12.4); results (12.5). Requirement spliced (RR-1 amendment, RR-8 slice 10 ruling, B-1, BQ-A awareness, status, Change History). No migration, no charge changed. Uncommitted, awaiting SA code review and QA |
