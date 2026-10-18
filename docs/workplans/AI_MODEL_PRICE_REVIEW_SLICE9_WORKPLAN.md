# Workplan: AI Model Price Review, Slice 9 (per-model price history view)

> **Last Updated**: 2026-10-18

**Developer:** Dev
**Requirement:** [AI_MODEL_PRICE_REVIEW_REQUIREMENT.md](/docs/requirements/AI_MODEL_PRICE_REVIEW_REQUIREMENT.md): MP-FR-17; UF-4; SA re-review RR-6; R-9 row 9; the slice 8 note "Runbook rows (for slice 9)"; UF-7 (page layout, help drawer)
**Branch:** `feature/ai-model-price-review-slice9` (worktree `neuronforge-model-pricing-s9`, off origin/main `f7429b57`, slice 8 merged as PR #462)
**Date:** 2026-10-18
**Status:** Code Complete (2026-10-18). SA approved the workplan with conditions SC9-1..SC9-11 (folded in); user decision BQ-9a (keep the email); T-0 clean. Uncommitted, awaiting SA code review and QA.

## Overview

Slice 9 adds a **read-only price history** for any model on `/admin/system-config`. A **History** button on each row opens the shared admin drawer, which lists every stored price of that model (token or image), current and retired, newest first, with the price in effect today marked. Each price says when it took effect and when it was replaced, and **who changed it and why**, read from the database: for an applied price, the pending-price line that produced it (applied by, reason, override reason, source URL, checked date, who entered it, the apply batch and its margin review). Prices from before the review flow show what the old audit recorded, the 2026-10-11 clean-up, an emergency runbook change, or "before price review: no record", and never an invented actor. Nothing on the view changes a price. No migration: the index the join needs shipped in slice 3. This is a read of a money path; it changes no charge.

## Table of Contents

1. [Analysis](#1-analysis) · 2. [Design](#2-design) · 3. [Files](#3-files) · 4. [Tests](#4-tests) · 5. [Risks](#5-risks) · 6. [Task list](#6-task-list) · 7. [Open questions for SA](#7-open-questions-for-sa) · 8. [Business questions](#8-business-questions) · 9. [T-0 record](#9-t-0-record) · 10. [Implementation notes and deviations](#10-implementation-notes-and-deviations) · [SA Review Notes](#sa-review-notes) · [QA Testing Report](#qa-testing-report) · [Commit Info](#commit-info) · [Change History](#change-history)

---

## 1. Analysis

Read on origin/main `f7429b57`. Production figures come from TL (slice 8 apply, 2026-10-18) and are re-read at T-0 with one read-only query (6, T-0).

| Fact | Consequence |
|---|---|
| `ai_model_pricing` (`20261052` baseline, `20261053`): `id, provider, model_name, input_cost_per_token, output_cost_per_token, cached_input_cost_per_token, effective_date, retired_date, created_at, proposal_id, proposal_line_id`; CHECK `(proposal_id IS NULL) = (proposal_line_id IS NULL)`; **`created_at` is nullable** (captured definition, `DEFAULT now()` with no NOT NULL) | Provenance is "both or neither". A legacy row may have no `created_at`: shown as "not recorded", never guessed. Ordering copies the charging reader exactly (2.4) |
| `ai_model_image_pricing` (`20261053`): `id, provider, model_name, size, quality, cost_per_image, effective_date, retired_date, created_at NOT NULL, proposal_id, proposal_line_id`, same pairing CHECK | The same design covers images, one unit per size and quality |
| **Index on `proposal_line_id`: present on both live tables** (`20261066`: `ai_model_pricing_proposal_line_idx`, `ai_model_image_pricing_proposal_line_idx`), composite FK `(proposal_line_id, proposal_id)` to the line. Lines have a PK on `id`; `apply_batch_id` has a partial index (`20261079`) | **No migration.** Every join in this slice is by primary key or an indexed column. There is no index on `(provider, model_name)` covering retired rows: the tables hold 55 and 0 rows, so a filtered read is a trivial scan (O-6) |
| `ai_price_proposal_lines` (`20261066`, `20261079`): `kind, provider, model_name, image_size, image_quality, input_per_1m, output_per_1m, cached_input_per_1m, price_per_image` (exact text), `source_url, checked_on, flags, state, decided_by, decided_at, decision_reason, override_reason, apply_batch_id, created_by, created_at`, `proposal_id` to `ai_price_proposals (source_kind 'manual' / 'fetch')` | Everything MP-FR-17 asks for (who applied, reason, override reason, source, checked date) is on the line; "who entered it" and "by hand or by provider check" come for free |
| `ai_price_apply_batches` (`20261079`): `applied_by, applied_at, line_count, margin_review_needed, margin_review_done, margin_review_by, margin_review_at, margin_review_note` | The batch row adds "applied together with N prices" and the margin review status (B-1..B-4) |
| Repositories: `AiModelPricingRepository` (`listActive`, `listActiveExact`, `listAll`), `AiModelImagePricingRepository` (`listActive`, `listActiveExact`), both **read-only, pinned by `livePriceWrites.guard` LW-2 to exactly those methods**, headers say "No method takes a caller-supplied filter". `listAll()` returns `select('*')`, so prices arrive as JS numbers | A history read needs **one new read method per live repository**, an LW-2 allow-list edit, and a header change; `listAll()` cannot be reused (floats). The filter question is O-1 |
| `AiPriceProposalRepository.findLinesForDecision(ids)` reads lines by id with exact text; `AiPriceApplyRepository` names `ai_price_apply_batches` | New `findAppliedLinesByIds` beside it and `findBatchesByIds` in the apply repository: **no new table literal in any repository, so LW-3 is unchanged** |
| Admin names: `comparisonModel.buildAdminEmailById()` uses `adminUserRepository.listActive()` and prints **"former admin"** for an id it does not find | Reusable as is, but a history is a permanent record: an admin who has since been deactivated would show as "former admin" (business question BQ-9a) |
| Old audit (before slice 6, helpers deleted in `477111a5`, events still registered): `AI_PRICING_CREATED`, `AI_PRICING_UPDATED` (`changes: {before, after}`), `AI_PRICING_ZERO_SET`, `AI_PRICING_DELETED` are written with **`entity_type 'ai_pricing'`, `entity_id` = the row id**. `AI_PRICING_SYNCED` is written with **`entity_type 'system'`, `entity_id 'ai_pricing'`** and only counts (`models_updated`, `models_added`, `source`): **no per-model record**. Before commit `29e885d7` (2026-09-20) and slice 1 (2026-10-10), single-row and Sync audits were not flushed (AB-5) | Per-row events can be joined by row id. A Sync run cannot be tied to a row; it can only be shown as "a Sync ran while this price was stored" (O-3). Missing events before September are expected: "no record" is the honest answer |
| Sync **updated rows in place** (`syncMany`: newest row per model updated, or a row inserted) | A pre-review row's stored price may not be the price it held when created. The view says so for rows from before 2026-10-16 (copy text, 2.6) |
| `audit_trail` columns: `user_id, actor_id, action, entity_type, entity_id, resource_name, changes, details, created_at` (`AuditTrailService.ts`); `user_id` falls back to `SYSTEM_ADMIN_USER_ID` with `details.system_action` | The actor is `actor_id`, then `user_id`; a system action is shown as "system", never as a person |
| `audit_trail` archiving is live (retention 90 / 180 / 365 days) | Events older than the retention may have moved to `archived_records`. This slice reads live audit only and says "no record in the live audit trail" (O-4) |
| `AuditTrailRepository` admin reads are pinned by `adminReadMethods.guard` (`ADMIN_METHODS`: callable only from `app/api/admin/**`); `ownerAuditReads.guard` already allow-lists the repository | New admin audit methods go in `ADMIN_METHODS` and are wired from the route (dependency injection, as `ai-activity` does), never called from `lib/` |
| Slice 2 retire script (`supabase/SQL Scripts/20261010_ai_model_pricing_retire_duplicate_rows.sql`) set `retired_date = (now() AT TIME ZONE 'utc')::date` on 12 rows, applied 2026-10-11; neither the old PUT nor Sync ever set `retired_date` | A row with no provenance retired on **2026-10-11** is a clean-up retirement (RR-6). Before slice 8 nothing else could retire a row, and after it every retirement is by Apply or the runbook (2.3) |
| Slice 6 merged 2026-10-16 **18:52:20 UTC** (`ac674ceb`); the runbook row `549fcc6e-3f63-4d06-b959-71c77759a12e` (`openai / text-embedding-3-small`) was written 19:56 UTC with `proposal_id` NULL; the run log is the runbook's section 8. The runbook has **no image paste** | A token row with no provenance created at or after the slice 6 merge is a runbook change: "changed by operator (emergency runbook)" with the run log reference (slice 8 note). An image row with no provenance is never a runbook row |
| Prod (TL, 2026-10-18): 43 active and 12 retired token rows, 0 image rows, 0 lines, 0 batches | On day one every token row is "pre-review" (with or without audit), "clean-up 2026-10-11" or the one runbook row; the applied branch is proven by tests until the first real Apply (slice 12) |
| Every stored provider is in `PRICE_PROVIDERS` and every stored model name passes `MODEL_ID_REGEX` (capture C-2, 45 pairs, plus `text-embedding-3-small`) | The route can reuse the pending-line schema pieces for its query; T-0 re-checks the live names |
| Comparison image rows may have `provider: null` ("an image model known only from a price key", the in-code table) | Such a model has no stored row by definition (the table's `provider` is NOT NULL). See 2.7 and O-7 |
| Page guards: `priceReview.source.test.ts` (each `/api/admin/model-pricing/*` path named in exactly one file; `page.tsx` names none; bodies via `readAdminResponse`/`readJsonBody`), `source.guard.test.ts` (NW-1: the page's one `fetch(` is the pricing GET), `priceTable.render` T-14 ("no History"), `pageLayout.render` ("History (coming later)") | The read lives in a new `priceHistoryRead.ts`; T-14 and the help pin are edited deliberately (2.8) |
| Shared admin layout: `AdminDrawer`, `DrawerSection`, `useDrawerResource` (a drawer that owns its read, keyed by row), `AdminLoading` / `AdminError`, `formatUtc` / `formatUtcDate`, `ADMIN_BUTTON`, `ADMIN_TABLE` | All reused; no new shared component |
| Exact decimals: `lib/ai/pricing-research/decimal.ts` (`perTokenToPerMillion`, `formatDecimal`, `parseDecimal`, `decimalFromNumberLiteral`) | Prices are cast to text in the read and converted to per 1M on the server; audit values (JSON numbers written from JS numbers) go through `decimalFromNumberLiteral`, the precedent for in-code literals |

**Root-cause note (CLAUDE.md rule 8 does not apply):** this slice touches no V6 pipeline or plugin code.

---

## 2. Design

### 2.1 Route `GET /api/admin/model-pricing/history`

`requireAdmin` first statement, then strict Zod on the query, Pino child with `correlationId`, `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, repositories only (through injected deps), no audit row (a read, as the comparison route), error format per CLAUDE.md.

```text
GET /api/admin/model-pricing/history?kind=token&provider=openai&model=gpt-4o-mini
GET /api/admin/model-pricing/history?kind=image&provider=openai&model=IMAGE_MODEL_ID
```

Query schema (`PriceHistoryQuerySchema`, strict, in `lib/ai/pricing-research/priceHistorySchema.ts`):

| Key | Rule |
|---|---|
| `kind` | `z.enum(['token', 'image'])` |
| `provider` | `z.enum(PRICE_PROVIDERS)` (shared with the pending-line schema) |
| `model` | the pending-line `modelId` (`MODEL_ID_REGEX`, 1–100 chars) |

Any other key, a repeated key, or a bad value: 400 `invalid_input`. A model with no stored rows is **200 with `rows: []`**, not 404 (an in-code-only or unpriced model has a real, empty history). Read failure: 500 with the generic message (details only in development).

### 2.2 Repository methods (new; `new-repository` skill, no throw, `RepositoryResult`, Pino with duration)

| Repository | Method | Query | Notes |
|---|---|---|---|
| `AiModelPricingRepository` | `listHistoryExact(key: { provider; modelName })` | `id, provider, model_name, input_cost_per_token::text, output_cost_per_token::text, cached_input_cost_per_token::text, effective_date, retired_date, created_at, proposal_id, proposal_line_id`; `.eq('provider').eq('model_name')`; **no** retired filter; order `effective_date DESC, created_at DESC` (the `listActive` order); `.limit(HISTORY_ROW_LIMIT + 1)` | O-1 (the filter). Read-only; LW-2 list gains the name. Header class 1 gains the history route |
| `AiModelImagePricingRepository` | `listHistoryExact(key)` | same shape, `size, quality, cost_per_image::text` | Same |
| `AiPriceProposalRepository` | `findAppliedLinesByIds(ids)` | `.in('id', chunk)` in chunks of 50; columns: line id, `proposal_id`, `kind`, unit, the four per-1M texts, `source_url, checked_on, state, decided_by, decided_at, decision_reason, override_reason, apply_batch_id, created_by, created_at`, plus `ai_price_proposals(source_kind)` (embedded through the existing FK) | Absent ids simply absent; the builder reports them (2.3 row A2) |
| `AiPriceApplyRepository` | `findBatchesByIds(ids)` | `id, applied_by, applied_at, line_count, margin_review_needed, margin_review_done, margin_review_by, margin_review_at, margin_review_note`, `.in('id', …)` chunked | No write; names only `ai_price_apply_batches` (already in LW-3) |
| `AuditTrailRepository` | `listAdminPricingRowEvents(rowIds)` **ADMIN ONLY** | `id, action, actor_id, user_id, created_at, entity_id, changes, details`; `entity_type = 'ai_pricing'`, `entity_id IN rowIds` (chunked), `action IN (AI_PRICING_CREATED, AI_PRICING_UPDATED, AI_PRICING_ZERO_SET)`; newest first; `.limit(200)` | Added to `ADMIN_METHODS` |
| `AuditTrailRepository` | `listAdminPricingSyncRuns()` **ADMIN ONLY** (only if O-3 = b) | `id, actor_id, user_id, created_at, details`; `action = AI_PRICING_SYNCED`, `entity_type = 'system'`, `entity_id = 'ai_pricing'`; newest first; `.limit(100)` | Added to `ADMIN_METHODS` |
| `AdminUserRepository` | `findEmailsByUserIds(ids)` (only if BQ-9a = keep the email) | `user_id, email` for the ids, **active or not** | Added to `ADMIN_METHODS`; otherwise `listActive()` is reused as the comparison does |

Every method takes ids or a Zod-validated key only; no free text reaches a filter. `supabaseServer` is intentional for each (global catalog with no owner column; admin-only callers), as the existing headers state.

### 2.3 Who and why, per row (pure `buildPriceHistory`, `lib/ai/pricing-research/priceHistory.ts`)

The route injects the reads (`deps`), so the admin-pinned calls stay in `app/api/admin/**` and the builder is testable offline. Precedence is **top to bottom; the first match wins**:

| # | Row type | Test | Shown as (`provenance.kind`) |
|---|---|---|---|
| A1 | **Applied** | `proposal_line_id` set, line found, `state = 'applied'` | `applied`: applied by (email), applied at (`decided_at`), reason, override reason (when set), source URL and checked date, entered by (email) and how (`manual` "entered by hand" / `fetch` "provider price check"), batch (count of prices applied together; margin review "not needed" / "open" / "done by X on D: note") |
| A2 | Applied, record unreadable | `proposal_line_id` set but the line is absent or not `applied` (impossible under the FK and CHECKs) | `provenance_missing`: "the record of this change could not be read"; `logger.warn` with the row and line ids. Never falls through to the audit or the runbook rule |
| R | **Runbook** | token row, no provenance, `created_at >= RUNBOOK_ERA_STARTS_AT` (`2026-10-16T18:52:20Z`, slice 6 merge) | `runbook`: "changed by operator (emergency SQL runbook)"; reference: "run log in the emergency SQL runbook, entry of {created_at UTC}" |
| P1 | **Pre-review, with audit** | no provenance, at least one row event (2.2) for the row id | `audit`: each event "created / edited / set to zero by {email or 'system'} on {UTC}", with the recorded values per 1M when present ("values not recorded" otherwise); events newest first |
| P2 | **Pre-review, no audit** | otherwise | `none`: "before price review — no record" |

Independently, each row has a **retirement** line:

| Test (first match) | `retirement.kind` | Words |
|---|---|---|
| `retired_date` NULL | — | none |
| no provenance and `retired_date = CLEANUP_RETIRED_ON` (`2026-10-11`) | `cleanup` | "retired in clean-up 2026-10-11 (duplicate or unused alias row; no charge changed)" |
| a newer row of the same unit exists | `replaced` | "replaced on {date} by the newer price above" (who and why are on that row) |
| otherwise | `no_record` | "retired on {date}; no record of why" |

And, for pre-review rows (created before `RUNBOOK_ERA_STARTS_AT`, no provenance), the note "Before 2026-10-16 Sync could overwrite this stored price in place without a per-model record" (2.6, the in-place update fact). If O-3 = b, Sync runs whose time falls inside the row's stored life (`created_at` to its replacement or now) are listed under it, labelled "Sync ran (all models; no per-model record)", at most 10 per row.

Both cut-over constants live in `priceHistory.ts`, each with the evidence in a comment (commit, run log, retire script), and are pinned by a unit test (O-2).

### 2.4 Order, "current", and dates

- **Units.** Token: one unit. Image: one unit per (size, quality), ordered by size then quality (`low`, `medium`, `high`, then alphabetical).
- **Order inside a unit:** `effective_date DESC, created_at DESC` as returned by the repository, which is the `listActive()` order. Same-day applies keep their `created_at` order (RR-6).
- **Current:** computed by the **charging rule**, not a copy: filter `retired_date IS NULL AND effective_date <= today (UTC)` keeping the repository order, then token: the first row; image: `selectActiveImagePrices` from `lib/ai/imagePricing.ts` (also skips a non-positive price). A test pins that the history's current id equals `comparisonModel`'s `currentRowId` on the same fixture.
- **Status per row:** `current`, `starts_later` (active, `effective_date` after today: "starts {date}, not charged yet"), `not_charged` (active and in effect but not the winner, the "superseded" row of the table), `retired`.
- **Took effect / replaced:** `effectiveDate`; `replacedOn` = the next newer row's `effective_date` in the unit, else `retired_date`, else null. Each row says "in effect from X" and, when known, "until Y".
- **"Now"** is the server's `generatedAt` (UTC), as the KPI strip. Dates print with `formatUtcDate`, times with `formatUtc`.

### 2.5 Response (Zod `PriceHistoryResponseSchema`, shared by the route test and the client read)

```typescript
{
  success: true,
  data: {
    generatedAt: string,            // ISO UTC
    kind: 'token' | 'image',
    provider: string,
    modelName: string,
    truncated: boolean,             // more than HISTORY_ROW_LIMIT stored rows; the newest are returned
    units: Array<{
      size: string | null,          // image only
      quality: string | null,
      rows: Array<{
        rowId: string,
        status: 'current' | 'starts_later' | 'not_charged' | 'retired',
        prices:
          | { kind: 'token'; inputPer1m: string; outputPer1m: string; cachedInputPer1m: string | null }
          | { kind: 'image'; perImage: string },
        effectiveDate: string,      // YYYY-MM-DD
        replacedOn: string | null,
        retiredOn: string | null,
        createdAt: string | null,
        provenance:
          | { kind: 'applied'; appliedBy: string; appliedAt: string; reason: string; overrideReason: string | null;
              sourceUrl: string; checkedOn: string; enteredBy: string; entrySource: 'manual' | 'fetch';
              batch: { lineCount: number; marginReview: 'not_needed' | 'open' | 'done';
                       reviewedBy: string | null; reviewedAt: string | null; reviewNote: string | null } | null }
          | { kind: 'provenance_missing' }
          | { kind: 'runbook'; reference: string }
          | { kind: 'audit'; events: Array<{ action: 'created' | 'updated' | 'zero_set'; by: string; at: string;
                                             inputPer1m: string | null; outputPer1m: string | null }> }
          | { kind: 'none' },
        retirement: null | { kind: 'cleanup' | 'replaced' | 'no_record' },
        preReviewNote: boolean,
        syncRuns?: Array<{ at: string; by: string; modelsUpdated: number | null; modelsAdded: number | null }>
      }>
    }>
  }
}
```

Prices are **decimal strings** end to end: the read casts to text, the builder uses `perTokenToPerMillion` and `formatDecimal`, the client prints the string. No `Number()` on a price anywhere (a source test pins it, 4). Ids of admins never reach the client; only emails, "former admin" or "system". Margin and reason texts are admin-written and rendered as text (React escapes them).

**Bounds:** `HISTORY_ROW_LIMIT = 200` rows per model (today the most for one model is about 5). Over the limit the newest 200 are returned with `truncated: true` and the drawer says "Showing the newest 200 prices". No paging UI in this slice (O-5).

### 2.6 Copy (`priceReviewCopy.ts`, `HISTORY_WORDS`)

All words in one place, plain English, no colour-only status (MP-NFR-8): drawer title "Price history", suffix the model; status chips in words ("Charged today", "Starts {date}", "Stored, not charged", "Retired"); the provenance and retirement sentences of 2.3; the pre-review note; the empty state ("No stored price for this model. Charges use {the built-in price list / no price}", the basis taken from the comparison row the page already holds); the truncation line; the archive caveat for P2 if O-4 is ruled that way. The help drawer's "History (coming later)" paragraph becomes "History" with one sentence on what it shows and that it changes nothing.

### 2.7 UI (`/admin/system-config`)

- **Entry point:** a **History** button (`ADMIN_BUTTON`, `aria-label` "Price history for {model}", `data-testid history-{row.key}`) in the Actions cell of every row that has a provider: compared rows and the stored-only rows (starts later, not charged, retired), which open their own model's history. O-8 asks whether this should be the icon-only `OpenRowButton` instead.
- **Drawer:** one page-level `AdminDrawer` (test id `price-history-drawer`), keyed by `{kind}:{provider}:{model}`, rendered once outside the table and the error branches (the L-4b pattern), with the existing help drawer beside it. The body is `PriceHistoryDrawerBody.tsx`, fed by `useDrawerResource(key, readPriceHistory)`: `AdminLoading` while loading, `AdminError` with the reader's words on failure, the history when ready. Focus returns to the opening button (D-6). Opening is a read only; Apply, Dismiss and the table are untouched.
- **Body:** per unit, a small `ADMIN_TABLE` (columns: In effect, Input /1M, Output /1M, Cached input /1M or Per image, Status) and under each row a `DrawerSection`-style block with the provenance and retirement sentences. The current row carries the "Charged today" chip and is first in its unit unless a later-dated row exists.
- **Image rows with `provider: null`** (in-code key only): no History button; they have no stored row by construction (O-7).
- **`priceHistoryRead.ts`:** the only file naming `/api/admin/model-pricing/history`; `fetch` with `cache: 'no-store'` and the `AbortSignal`; body through `readAdminResponse`, then `PriceHistoryResponseSchema.safeParse`; never throws (network words on rejection); client logger only.

### 2.8 Guards and pins (deliberate edits, each named in the PR)

| Guard | Edit |
|---|---|
| `livePriceWrites.guard` LW-2 | `READ_ONLY_REPOSITORIES` gains `listHistoryExact` for both live repositories. LW-1, LW-3 and LW-5 unchanged: no new literal, no write, no SQL |
| `adminReadMethods.guard` | `ADMIN_METHODS` gains `listAdminPricingRowEvents` (and `listAdminPricingSyncRuns`, `findEmailsByUserIds` per O-3 / BQ-9a); each must be called from `app/api/admin/model-pricing/history/route.ts` only |
| `priceReview.source.test.ts` | `/api/admin/model-pricing/history` named only in `priceHistoryRead.ts`; the page names none; the body goes through `readAdminResponse` |
| `priceTable.render` T-14 | "no History" becomes "one History per row with a provider"; Apply/Dismiss counts unchanged |
| `pageLayout.render` help test | "History (coming later)" becomes the new sentence |
| `source.guard` NW-1 | unchanged: `page.tsx` still has one `fetch(`; the history read is in its own file |

---

## 3. Files

| File | Action | Reason |
|---|---|---|
| `app/api/admin/model-pricing/history/route.ts` (+ `__tests__/route.test.ts`) | create | 2.1, wires the deps (2.3) |
| `lib/ai/pricing-research/priceHistory.ts` (+ `__tests__/priceHistory.test.ts`) | create | pure builder: precedence, retirement, current, dates, per-1M conversion, constants |
| `lib/ai/pricing-research/priceHistorySchema.ts` (+ test) | create | query and response Zod schemas |
| `lib/repositories/AiModelPricingRepository.ts`, `AiModelImagePricingRepository.ts` | modify | `listHistoryExact`; header class 1 gains the history route; the filter note per O-1 |
| `lib/repositories/AiPriceProposalRepository.ts` | modify | `findAppliedLinesByIds` |
| `lib/repositories/AiPriceApplyRepository.ts` | modify | `findBatchesByIds` |
| `lib/repositories/AuditTrailRepository.ts` | modify | `listAdminPricingRowEvents` (+ `listAdminPricingSyncRuns` per O-3) |
| `lib/repositories/AdminUserRepository.ts` | modify (per BQ-9a) | `findEmailsByUserIds` |
| `lib/repositories/types.ts` | modify | history row, line and batch read types |
| `lib/repositories/__tests__/*` (one test file per touched repository, or the existing ones) | create/modify | one test per new method |
| `app/admin/system-config/priceHistoryRead.ts` | create | the client read (2.7) |
| `app/admin/system-config/components/PriceHistoryDrawerBody.tsx` | create | drawer body |
| `app/admin/system-config/page.tsx` | modify | History button, the drawer, header comment ("No history yet" removed), help paragraph |
| `app/admin/system-config/priceReviewCopy.ts` | modify | `HISTORY_WORDS` |
| `app/admin/system-config/__tests__/priceHistory.render.test.tsx` | create | drawer body and page wiring |
| `app/admin/system-config/__tests__/priceTable.render.test.tsx`, `pageLayout.render.test.tsx`, `priceReview.source.test.ts` | modify | 2.8 |
| `lib/ai/pricing-research/__tests__/livePriceWrites.guard.test.ts` | modify | LW-2 |
| `lib/repositories/__tests__/adminReadMethods.guard.test.ts` | modify | `ADMIN_METHODS` |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | modify | row 114 `model-pricing/history#GET`, census re-counted from disk |
| `docs/requirements/AI_MODEL_PRICE_REVIEW_REQUIREMENT.md` | modify | status, Change History (done at workplan time; again at code complete) |

Not touched: migrations, `lib/ai/pricing.ts`, `chargePricing.ts`, `imagePricing.ts` (only its pure `selectActiveImagePrices` is imported), providers, the apply / dismiss routes, the runbook, audit events (no new event: a read is not audited).

---

## 4. Tests

All offline, inside the existing Jest job. No new directory walk (the edits to `livePriceWrites` and `adminReadMethods` change lists, not scans); render tests mount the drawer body directly with a mocked `fetch`, plus one page-level wiring test. **No added CI time** beyond a few hundred milliseconds of unit tests.

- **Route** (`route.test.ts`, mocked deps and `requireAdmin`): 401 and 403 before the query is read and before any repository call; 400 for a missing `kind`, an unknown key, a provider outside the list, a model failing the regex, a repeated key; 200 happy path (token) validated by `PriceHistoryResponseSchema`; 200 image grouping; 200 `rows: []` for a model with no row; 500 with no `details` outside development when a read fails; the response holds no admin uuid; no audit call.
- **Pure builder** (`priceHistory.test.ts`), one case per branch of 2.3 and 2.4: A1 with batch (margin not needed, open, done) and with an override reason; A1 manual vs fetch; A2 (line absent, line not applied) never falls through; R at the exact cut-over instant (`>=`) and one second before (becomes P1/P2); R never for an image row; P1 created/updated/zero_set, values present and absent, `system` actor, newest first; P2; retirement `cleanup` only without provenance and only on 2026-10-11, `replaced`, `no_record`; current equals `comparisonModel.currentRowId` for the same rows (parity); `starts_later` and `not_charged`; same-day rows keep `created_at` order; null `created_at`; per-1M strings exact (`0.000000075` per token prints `0.075`, never `0.08`); `truncated`. Fixtures reproduce the prod shapes: the runbook row `549fcc6e-…`, a slice 2 duplicate, a pre-review row with and without audit.
- **Schemas:** strict query; response round-trip; a price as a number is refused.
- **Repositories** (one test per method, recording client): the exact column string with `::text` casts; filters; order; limit; chunking at 50 ids; error path returns `{ data: null, error }` and logs no admin email or note text.
- **UI** (`priceHistory.render.test.tsx`): loading, error words, empty state with the basis; current chip; each provenance sentence; runbook reference; cleanup line; truncation line; focus returns to the History button; History present on compared and stored-only rows, absent on an image row without provider; opening the drawer sends exactly one GET and no POST.
- **Source / guards:** 2.8; plus a scan of `priceHistory.ts` and `PriceHistoryDrawerBody.tsx` for `Number(`, `parseFloat(` and `toFixed(` on prices (none allowed); no backslash in any new file (Tailwind escape rule).

---

## 5. Risks

| # | Risk | Mitigation |
|---|---|---|
| K-1 | A row is shown with an invented actor or reason | Precedence table (2.3) with "no record" as the default; A2 never falls through; runbook and clean-up rules keyed on recorded facts (timestamps, dates) and pinned by tests |
| K-2 | A Sync-overwritten pre-review row reads as if it always held that price | The pre-review note (2.3, 2.6); audit events show the recorded before/after when they exist |
| K-3 | The cut-over constants are wrong (deploy lag after the slice 6 merge; clean-up date in UTC) | T-0 read-only check of the 12 retired rows' `retired_date` and of every no-provenance row created on 2026-10-16; SA rules on the constants (O-2) |
| K-4 | "Current" in the history differs from what is charged | Computed with the charging selection rule and a parity test against the comparison read model |
| K-5 | Float drift in displayed prices | `::text` casts, `decimal.ts`, response schema refuses numbers, source scan |
| K-6 | Audit rows archived, so a pre-review row says "no record" although one existed | Words say "in the live audit trail"; O-4 |
| K-7 | A future second runbook (images) or a new writer breaks the rules | The runbook rule is token-only by design; LW-5 still allows one writer; a new writer would need its own slice and an update here |
| K-8 | Large models' history grows past the bound | 200-row cap with `truncated`; years away at today's rate (O-5) |
| K-9 | Merge conflicts with other sessions in `page.tsx`, the copy file, the guards, the admin register | Small, targeted edits; merge origin/main at T-0 and before handing to SA |

---

## 6. Task list

- [x] ✅ T-0 checklist, at implementation start (record in §9):
  - [x] ✅ `git fetch` and `git merge origin/main` (merge only, never stash): already at `f7429b57`; re-checked before hand-back, still current
  - [x] ✅ one read-only query (run by TL on production, 2026-10-18): no SC9-9 stop rule fired
  - [x] ✅ recount the admin register census and `ADMIN_METHODS`: row 114 was taken (rows 114–117 registered by the slice 8 re-count), so the history route is row **118**; census 110 / 81 files before, 111 / 82 after; `ADMIN_METHODS` 7 before, 13 after
- [x] ✅ T-1: schemas (`priceHistorySchema.ts`) + tests (including the 46 production pairs)
- [x] ✅ T-2: repository methods (`new-repository` skill) + one test each; headers updated (SC9-1, SC9-3, SC9-4)
- [x] ✅ T-3: pure builder `priceHistory.ts` + tests (precedence, retirement, current parity, exact decimals)
- [x] ✅ T-4: route (`new-api-route` skill, `requireAdmin` first) + tests; admin register row 118 (114 was taken, SC9-9)
- [x] ✅ T-5: `priceHistoryRead.ts`, `PriceHistoryDrawerBody.tsx`, `page.tsx` (button, drawer, help, header comment), copy + render tests
- [x] ✅ T-6: guard edits (LW-2 and the LW-4 image negative control, `ADMIN_METHODS`, page source pins, T-14, help pin)
- [x] ✅ T-7: eslint on touched files, targeted Jest, `tsc` filtered to touched files, `typecheck:bos-llm`; `git diff --stat`; requirement status and Change History; hand to SA

---

## 7. Open questions for SA

| # | Question | Dev proposal |
|---|---|---|
| O-1 | The live repositories' headers say "No method takes a caller-supplied filter". History needs one model. (a) `listHistoryExact({ provider, modelName })` filtered in SQL, the key Zod-validated (provider enum, model regex), header amended; or (b) `listAllExact()` with no filter, filtered in TS | **(a)**. (b) reads every row per drawer open and silently truncates at PostgREST's row cap as the table grows; (a) is bounded and indexed by the PK after the filter |
| O-2 | Cut-over constants: `RUNBOOK_ERA_STARTS_AT = 2026-10-16T18:52:20Z` (slice 6 merge, not its deploy) and `CLEANUP_RETIRED_ON = 2026-10-11`, as code constants with evidence comments; or a stored marker | Code constants (no migration, R-9 says none). A Sync between merge and deploy would only produce a row with no provenance; T-0 lists all such rows to prove none exists besides `549fcc6e-…` |
| O-3 | Sync events cannot be tied to a row (entity `system`, counts only). (a) do not show them; (b) list the Sync runs that fell inside a row's stored life, labelled "all models; no per-model record" | **(b)**, it is what RR-6 asks and is factual; capped at 10 per row, 100 read |
| O-4 | Archived audit rows: read `archived_records` too, or say "no record in the live audit trail" | Say it; no archive read in this slice (the archive repository is keyed for per-user erasure and export) |
| O-5 | Bound: 200 rows per model, `truncated` flag, no paging | Yes |
| O-6 | No index covers `(provider, model_name)` over retired rows | None needed at 55 / 0 rows; revisit if a table passes ~10,000 rows |
| O-7 | Image rows known only from the in-code key (`provider: null`) | No History button; nothing is stored for them |
| O-8 | Entry point: a labelled **History** button in the Actions cell, or the icon-only `OpenRowButton` (D-2, LF-8) in a new last column | Labelled button: the row already has labelled actions, and a new column changes the table's column pins |
| O-9 | Hard-deleted rows from before slice 6 (`AI_PRICING_DELETED`, row gone) | Not shown: the history is built from kept rows (RR-6); the audit trail page still lists the deletions |
| O-10 | Audit values are JSON numbers written from JS numbers | Print through `decimalFromNumberLiteral` (shortest decimal, the in-code precedent), labelled "as recorded" |

---

## 8. Business questions

| # | Question | Recommendation |
|---|---|---|
| **BQ-9a** | The history names the admin who applied each price. When that person later loses admin access, should the history still show their email, or just "former admin"? (Today the pending-price list shows "former admin".) | **Keep showing their email.** The history is the permanent record of who changed what customers pay; hiding the name of someone who has left is exactly when it matters |

---

## 9. T-0 record

Read-only production query run by TL on 2026-10-18 (SA SC9-9 stop rules):

| Check | Result | Stop rule |
|---|---|---|
| No-provenance rows created at or after `2026-10-16T18:52:20Z` | exactly 1: `549fcc6e-3f63-4d06-b959-71c77759a12e` openai / text-embedding-3-small, created 2026-10-16 19:56:29.842154+00 (the logged runbook run) | not fired |
| No-provenance rows with `retired_date = 2026-10-11` | 12 | not fired (12 expected) |
| No-provenance rows retired on any other date | 0 | not fired |
| Image rows without provenance | 0 (the image table is empty) | not fired |
| Rows with NULL `created_at` | 0 | — |
| Counts | 43 active, 12 retired (55); providers anthropic, google, kimi, openai | — |
| Every stored (provider, model_name) against `PRICE_PROVIDERS` / `MODEL_ID_REGEX` | all 46 pairs pass, proven by `priceHistorySchema.test.ts` (one case per pair) | not fired |

**CR9-4 (SA code review), run by TL 2026-10-18:** a read-only PostgREST GET on production (`jgccgkyhpwirgknnceoh`) of `ai_price_proposal_lines` with `select=` `APPLIED_LINE_HISTORY_COLUMNS` (including `ai_price_proposals(source_kind)`) and `id=in.(<random uuid>)` answered HTTP 200 with body `[]`, no error. Negative control `select=id,no_such_table(x)` answered 400 PGRST200 (relationship not found), proving the embed is resolved even on an empty result. **PASS.**

Branch: `git fetch` at start and again before hand-back; `origin/main` still `f7429b57`, nothing to merge. Admin register: row 114 had been taken by the slice 8 re-count (rows 114–117), so the history route is **row 118**; census re-counted from disk: 81 files / 110 handlers before, **82 / 111 = 105 `requireAdmin` + 6 inline + 0 open** after. `ADMIN_METHODS`: 7 before, **13** after.

---

## 10. Implementation notes and deviations

Every SC9 condition and O-ruling is implemented; the table maps them, then the deviations follow.

| Condition | Where |
|---|---|
| SC9-1 `findEmailsByUserIds` | `AdminUserRepository`: `user_id, email`, chunks of 50 after de-dup, no `is_active` filter, empty list = no query, counts-only logs; header paragraph on why it includes deactivated admins |
| SC9-2 names never degrade | `loadPriceHistory`: one de-duplicated lookup (decided_by, created_by, applied_by, margin_review_by, audit and Sync `actor_id ?? user_id`, system ids excluded); a failed lookup throws, route 500. No row = "not on the admin list"; `SYSTEM_ADMIN_USER_ID`, the all-zero id, a null actor or `details.system_action` = "system" |
| SC9-3 callers pinned | `ADMIN_METHODS` + `listHistoryExact`, `findEmailsByUserIds`, `listAdminPricingRowEvents`, `listAdminPricingSyncRuns`, and the recommended `findAppliedLinesByIds`, `findBatchesByIds`. LW-2 lists `listHistoryExact` on both repositories; LW-4 image fixture and message updated |
| SC9-4 audit reads | numbered header entry (fourth and fifth admin exceptions), exported column constants, `AUDIT_EVENTS` filters, empty / over-cap / non-UUID id lists refused before any query, `reachedLimit` surfaced as `auditTruncated` / `syncTruncated` and shown in the drawer |
| SC9-5 lenient parsing | Zod `safeParse` with `passthrough`; finite numbers through `decimalFromNumberLiteral`, plain-decimal strings, anything else "values not recorded"; UPDATED shows "from … to …"; stored `::text` values unreadable (NaN) print "not readable" with a warn naming the row id only |
| SC9-6 replaced | see D-2 |
| SC9-7 cached and zero | `cachedNote` (`stored`, `half_of_input`, `stored_not_used`, `none`, `unreadable`) with the comparison's rule; `storedAsZero` keeps status `current`; parity test in `comparisonModel.test.ts` covers a zero-priced current row and an Anthropic row with a stored cached rate |
| SC9-8 client gating | `isHistoryQueryable` (the query schema itself, so `MODEL_ID_REGEX` is imported, not copied); `URLSearchParams`; `priceReview.source.test.ts` pins the schema's imports (`zod`, `./officialSources`, `./pendingLineSchema`) and that those import nothing server-side |
| SC9-9 stop rules | §9: none fired |
| SC9-10 runbook | reference names the row id first, time second; R never for a null `created_at` or an image row; `>=` tested at the instant and one second before |
| SC9-11 Sync runs | read once per request (only when a row has no provenance and is not the runbook), cap 100 with `syncTruncated`; at most 10 per row with "and N more"; never under applied or runbook rows |
| O-9 footnote | implemented (static line at the drawer's foot) |

**Deviations (for SA):**

| # | Deviation | Why |
|---|---|---|
| D-1 | Response shape refined from §2.5: a person is a structured `{ kind: 'admin', email } / { kind: 'not_on_admin_list' } / { kind: 'system' }` and the client words it; `runbook` carries no `reference` string (the row id and `createdAt` are on the row); an empty history is `units: []`; added `neverCharged`, `moreSyncRuns`, `auditTruncated`, `syncTruncated`, `cachedNote`, `storedAsZero`, optional `before…Per1m`; a price is `string | null` (null = not readable). All objects `.strict()` | Copy stays in `HISTORY_WORDS` (SC9-2); strict objects refuse an id slipping into the body |
| D-2 | `replacedOn` is null for `current` and `starts_later` rows; for the others it is SC9-6's rule (the closest newer row in the unit with `effective_date` ≤ today, or `retired_date`, whichever is earlier). `neverCharged` is set only when that successor's date equals the row's own date | Applied literally, a current row standing behind a retired same-date sibling would read "never charged" while it is charged today |
| D-3 | The row cap is a constant in each live repository (`PRICE_HISTORY_ROW_LIMIT`, `IMAGE_PRICE_HISTORY_ROW_LIMIT`) and in the schema (`HISTORY_ROW_LIMIT`), pinned equal by `priceHistoryReads.test.ts`; the repositories return `{ rows, truncated }` | Importing one repository from the other breaks suites that mock the token repository |
| D-4 | The row-event read queries 50 ids at a time, each capped at 200, merges newest first and re-caps; `reachedLimit` if any query or the merge reached the cap | Keeps each URL short (200 ids) without losing the "cut" signal |
| D-5 | `storedAsZero` follows `lib/ai/pricing.ts` D-0 C-1 in full: input ≤ 0, or output ≤ 0 for a model that is not input-only (`isInputOnlyPricedModel`, injected) | SC9-7 named input 0; output 0 on a text model is equally "not a price" for charging |
| D-6 | A Sync run counts under a row up to the end of its replacement day (UTC) | A run on the replacement day may precede the replacement; the words already say "may or may not" |
| D-7 | `preReviewNote` is set for no-provenance, non-runbook rows created before the cut-over or with no `created_at` | An image row with no provenance after the cut-over (none exist, §9) is not "pre-review" |
| D-8 | The lines and batches reads also refuse a non-UUID id before any query | Defence in depth; ids come from stored rows |
| D-9 | `PRICE_REVIEW_NOTE`'s last sentence ("price history comes in a later release") now says what History shows; the History button carries `aria-haspopup="dialog"` | The old sentence became false |
| D-10 | The repository history reads accept an optional `AbortSignal`, but the route passes none | SA optimisation, optional; the route has no deadline today |
| D-11 | The register's summary line (stale since slice 6: "97 · 110 rows, 103 live") corrected to 105 · 6 · 0 and 118 rows / 111 live | Found while adding row 118 |

**SA code review fixes (2026-10-18):**

| # | Fix | Test |
|---|---|---|
| CR9-1 | `successorDate` is computed for every row; a retired row is "replaced" only when a newer row in the unit has started (`effective_date` ≤ today), otherwise "no record of why" (was `index > 0`) | `priceHistory.test.ts`: retired row with only a starts-later sibling → `no_record` |
| CR9-2 | New actor kind `not_recorded` in `ActorSchema`, `HISTORY_WORDS.actorNotRecorded` ("not recorded"), worded in `actorWords`. "system" only for `systemActorIds` or `details.system_action === true`; a null or empty id is `not_recorded` (e.g. `audit_trail.user_id` nulled by `ON DELETE SET NULL`) | `priceHistory.test.ts`: both ids null → `not_recorded`; null with `system_action: true` → `system`. Render test words it |
| CR9-3 | `adminReadMethods.guard`: the comment-stripped non-test file list is built once at `describe` scope; each method tests its pattern against it; same assertions. **Suite time: 21.7 s / 25.4 s before, 5.8 s / 7.3 s after** (two runs each, local Windows) | the guard itself (52 tests) |
| CR9-4 | TL's production embed check, recorded in §9: PASS | — |
| CR9-5 | `deletedFootnote`: "…the audit trail page shows any recorded deletion." | render test pins the new text |
| Optional | blank line before the `listHistoryExact` JSDoc. `HISTORY_WORDS.truncated` keeps the literal 200: `priceReviewCopy.ts` is a plain module with no imports by its own header, and `priceHistoryReads.test.ts` pins the cap at 200 | — |

Re-run after the fixes: the touched suites (pricing-research incl. QA's `priceHistory.qa.test.ts`, `app/admin/system-config`, `app/api/admin/model-pricing`, the touched repositories, `priceHistoryReads`, `adminReadMethods.guard`, `lib/audit/__tests__`): 63 suites, 1107 passed, 6 failed (the known `openaiPricingAdapter` CRLF failures); `test:authz-guard` 203 passed; eslint on the changed files clean.

`priceHistory.ts` reads `provider === 'openai'` for the cached rule, mirroring `comparisonModel.tokenCurrent` (SA F-1): the one provider whose charge reads the cached column. No new hardcoding.

**Verification (2026-10-18):** targeted Jest: pricing-research, `app/api/admin/model-pricing` (all routes), `lib/audit/__tests__`, the touched repositories and the new `priceHistoryReads.test.ts`, `adminReadMethods.guard`: 53 suites, 966 passed, 6 failed (`openaiPricingAdapter.test.ts`, the known local CRLF failures, untouched); `app/admin/system-config`: 11 suites + the new render suite, all pass; `npm run test:authz-guard`: 203 passed. `npx tsc --noEmit -p .`: no error in any touched file (repo baseline otherwise unchanged). `npm run typecheck:bos-llm`: passed, 0 new (it reports one baseline entry fixed in `app/api/onboarding/build/route.ts`, not touched by this slice). eslint on the touched files: 0 errors (one pre-existing `any` warning in `types.ts` line 710, not this slice's).

---

## SA Review Notes

**Reviewed by SA — 2026-10-18**
**Status:** ✅ APPROVED WITH CONDITIONS (SC9-1..SC9-11). Dev may start at T-0 once the conditions are folded in; no second workplan review is needed unless a T-0 stop rule (SC9-9) fires.

### Verification of the Analysis (read on `f7429b57` in this worktree)

| Claim | Verified |
|---|---|
| Table columns, provenance pairing CHECK, composite FK, `proposal_line_id` indexes (`20261066` lines 268–276), batch columns and partial index (`20261079`) | ✅ No migration is needed |
| Line columns; `decided_by` / `created_by` / `applied_by` / `margin_review_by` are plain uuids with no FK to a user table | ✅ Ids survive a user deletion; the name lookup is the only thing that can lose them |
| `ai_price_apply_lines` retires the in-effect rows with `retired_date = v_today` and inserts the new row with `effective_date = v_today` and provenance; the line gets `decided_by`, `decided_at`, `decision_reason`, `override_reason`, `apply_batch_id` | ✅ A1 reads exactly what Apply writes |
| Both live repositories read-only; LW-2 pins `['listActive','listActiveExact','listAll']` / `['listActive','listActiveExact']`; header "No method takes a caller-supplied filter" | ✅ |
| LW-3: an embedded `ai_price_proposals(source_kind)` inside a select string is not a whole quoted literal, and `'ai_pricing'` does not match `ai_price_` / `ai_model_` | ✅ LW-3 unchanged |
| `adminReadMethods.guard` `ADMIN_METHODS` + caller walk restricted to `app/api/admin/**` | ✅ (it pins the directory, not the single route file the workplan names; that is sufficient) |
| Old audit helpers (`477111a5^:lib/audit/admin-helpers.ts`): CREATED / ZERO_SET put prices in **`details`**, UPDATED puts them in **`changes`** (caller-shaped), SYNCED is `system` / `ai_pricing` with counts only | ✅ but see SC9-5: the workplan does not say where each event's values live |
| Runbook retires the old row by id with today's date and has no image paste; run log row names `549fcc6e-…` | ✅ |
| `useDrawerResource(key, read(key, signal))`, `AdminDrawer`, `OpenRowButton`, `readAdminResponse`, `selectActiveImagePrices` (accepts text prices), `comparisonModel` `currentRowId` (token: first active row, no zero skip) | ✅ |
| `decimalFromNumberLiteral` handles exponent form (`7.5e-8`); `parseDecimal` **throws** on anything not a plain decimal | ✅ — see SC9-5 |
| Page pins: T-14 "no History", help "History (coming later)", NW-1 one `fetch(` in `page.tsx` | ✅ |
| Register next row 114 | ✅ today; may be taken by a parallel session (SC9-9) |

No phase or rule-7 issue: route-injected repository deps is the existing `business-os/ai-activity` pattern; no new shared component; no new event; no migration; no new directory walk.

### Rulings on the open questions

| # | Ruling |
|---|---|
| O-1 | **(a) approved**: `listHistoryExact({ provider, modelName })`, SQL-filtered, key only from the Zod-parsed query. Amend both headers precisely: "Exactly one method, `listHistoryExact`, takes a key; it is admin-only (class 1, the history route), the key is Zod-validated (provider enum, `MODEL_ID_REGEX`), and the billing reader never calls it." Pinned by SC9-3 |
| O-2 | **Code constants approved** (`RUNBOOK_ERA_STARTS_AT = 2026-10-16T18:52:20Z`, `CLEANUP_RETIRED_ON = 2026-10-11`), each with its evidence comment and a unit-test pin. The merge instant (not the deploy) is the conservative choice only because T-0 proves no other row exists in the merge-to-deploy gap; SC9-9 makes that a stop rule, not a note |
| O-3 | **(b) approved**, with the wording and bounds of SC9-11. RR-6 explicitly asks for "any recorded Sync … audit event" |
| O-4 | **Approved**: live audit only, no `archived_records` read (that repository is per-user erasure/export scoped; widening it is out of proportion). P1/P2 words say "in the live audit trail" |
| O-5 | **Approved**: 200 rows, `truncated`, no paging |
| O-6 | **Approved**: no index. Revisit only if either table passes ~10,000 rows |
| O-7 | **Approved**: no History button for `provider: null` image rows. Extended by SC9-8 (also no button when the name fails the schema) |
| O-8 | **Approved**: labelled **History** button in the existing Actions cell (no new column, no column-pin churn). Copy "History", `aria-label` with the model |
| O-9 | **Approved**: hard-deleted rows are not shown. Optional: a one-line static footnote "Prices deleted before 2026-10-16 are not listed here; the audit trail page shows deletions" (Optimisation) |
| O-10 | **Approved with SC9-5**: numbers via `decimalFromNumberLiteral`, labelled "as recorded"; plain-decimal strings accepted too; anything else "values not recorded"; never throws |

### BQ-9a (decided by the user 2026-10-18, via TL)

**Decision: keep the email of an admin who later loses access** — the history is the permanent record. Consequences folded in as SC9-1 / SC9-2: `AdminUserRepository.findEmailsByUserIds` is **in scope** (no longer optional), and `buildAdminEmailById()` / `listActive()` is **not** reused for this view. (Had the answer been "former admin", `listActive()` would have been reused and no new admin method added; recorded for traceability only.)

### Conditions

1. **SC9-1 — `findEmailsByUserIds(ids)` (BQ-9a).** On `AdminUserRepository`: select exactly `user_id, email`; `.in('user_id', chunk)` in chunks of 50 after de-duplication; **no `is_active` filter** (deactivated admins included, by decision); rows with a null `user_id` (seeded, never bound) are simply not matched; returns a `Map`-friendly array; never logs an email (unlike `deactivateByEmail`'s existing log line); empty input returns `[]` with no query. Added to `ADMIN_METHODS`; header gains a short paragraph on why this read includes deactivated rows (permanent record, user decision 2026-10-18). One unit test per behaviour (chunking, no `is_active` filter, error path).
2. **SC9-2 — Names never degrade silently.** One de-duplicated name lookup per request covering `decided_by`, `created_by`, `margin_review_by`, and audit `actor_id ?? user_id`. If that read **fails**, the route returns 500 (generic message) — it must not fall back to labelling everyone, as `buildAdminEmailById` does on error. An id with no `admin_users` row at all is shown as **"not on the admin list"**, not "former admin": pre-2026-09-21 audit actors were admins by `profiles.role` and may never have had an `admin_users` row, so "former admin" would be an invented fact. `SYSTEM_ADMIN_USER_ID` (or `details.system_action`) is "system". Copy in `HISTORY_WORDS`; tests for all four outcomes (email, deactivated admin's email, not on the list, system).
3. **SC9-3 — Callers pinned without a new walk.** Add **`listHistoryExact`, `findEmailsByUserIds`, `listAdminPricingRowEvents`, `listAdminPricingSyncRuns`** to `ADMIN_METHODS`, so the existing walk proves each is called only from `app/api/admin/**` (this is what makes the O-1 header promise "never the billing reader" enforced, at zero added CI time). Update the guard's header list. In `livePriceWrites.guard`: LW-2 gains `listHistoryExact` for both repositories **and the LW-4 negative control for the image repository must be updated** — its `reads` fixture and its expected message string (`expected listActive, listActiveExact`) will otherwise fail. `findAppliedLinesByIds` / `findBatchesByIds` may also go in `ADMIN_METHODS` (recommended, not required).
4. **SC9-4 — Audit reads follow the existing admin-exception pattern** in `AuditTrailRepository`: a numbered header entry for each new method (what it reads, why it is not `user_id`-scoped — platform price catalogue events, `shared` audience — and that only `app/api/admin/**` calls it); exported column constants (`id, action, actor_id, user_id, created_at, entity_id, changes, details`, and the Sync columns), no ip / user agent / email columns; action filters from `AUDIT_EVENTS` constants, not string literals; refuse an empty or over-cap id list before any query (as `listAiActionEntriesAllAccountsByGroupIds`); the 200 / 100 caps report `reachedLimit`, surfaced in the response (`auditTruncated`) and in the drawer ("older audit events may not be shown"). A silent cap on a "who changed it" view is not acceptable.
5. **SC9-5 — Audit values and price text parsed defensively.** CREATED and ZERO_SET read `details.input_cost_per_token` / `details.output_cost_per_token`; UPDATED reads `changes.after` (and `changes.before`, shown as "from … to …" when both are readable). The JSONB is untyped legacy data: parse with a lenient Zod `safeParse`; accept a finite number (through `decimalFromNumberLiteral`) or a string passing `isPlainDecimal`; anything else is "values not recorded". The response event type gains optional `beforeInputPer1m` / `beforeOutputPer1m`. The builder **never throws**: every `parseDecimal` / `perTokenToPerMillion` on a stored `::text` value is guarded (Postgres `numeric` can hold `NaN`), a bad value prints "not readable" and logs a `warn` with the row id only. Tests: number, exponent-form number, numeric string, garbage string, missing key, `changes` without `after`.
6. **SC9-6 — Define "replaced" precisely.** `replacedOn` = the earlier of (a) the `effective_date` of the next newer row in the unit **whose `effective_date` ≤ today** (a starts-later row has not replaced anything yet) and (b) `retired_date`. When `replacedOn` equals the row's own `effective_date`, the row says "never charged: a newer price for the same date took precedence" instead of "from X until X" (this is what some clean-up duplicates are). Tests for: Apply-retired row, runbook-retired row, clean-up duplicate with a same-date sibling, active row shadowed by a newer in-effect row, row with only a starts-later successor.
7. **SC9-7 — Do not show a stored value as a charged price when charging ignores it.** Cached input follows the comparison's rule exactly (`comparisonModel` lines 262–266, SA F-1): for OpenAI, a stored rate > 0 is the rate, a 0 / null shows "not set (charged at half the input price)"; for other providers a stored cached rate is shown as "stored, not used for this provider". A current token row stored at input 0 keeps status `current` (parity with `currentRowId`) but carries the words "stored as 0: not treated as a price" (`lib/ai/pricing.ts` D-0 C-1). The parity test includes a zero-priced row and a non-OpenAI row with a cached rate.
8. **SC9-8 — Client gating and client-safe schema.** The History button renders only when the row has a provider **and** the model name passes the shared `MODEL_ID_REGEX` (imported, not copied), so the button can never produce a 400. `priceHistoryRead.ts` builds the query with `URLSearchParams`. `priceHistorySchema.ts` is imported by client code, so it may import only `zod` and the existing client-safe pieces (`officialSources`, `bounds`, `pendingLineSchema`); no logger, repository, or server module, directly or transitively (add one source assertion to `priceReview.source.test.ts`).
9. **SC9-9 — T-0 stop rules (return to SA, do not patch around).** Stop if any of: a row with `proposal_line_id IS NULL` and `created_at >= 2026-10-16T18:52:20Z` other than `549fcc6e-…`; the count of no-provenance rows with `retired_date = 2026-10-11` is not 12; any no-provenance row retired on any other date; any image row exists without provenance; any stored `(provider, model_name)` fails `PRICE_PROVIDERS` / `MODEL_ID_REGEX`. Do not add an exception list of ids to the builder. Re-count the admin register (row 114 and the census) and `ADMIN_METHODS` at T-0 and again before code review (parallel sessions).
10. **SC9-10 — Runbook and pre-review details.** The runbook reference names the **row id** as the run log does ("emergency SQL runbook, run log entry for row 549fcc6e…"), with the time as secondary. R never applies to a null `created_at`; a null-`created_at` no-provenance row gets the pre-review note (it is legacy by construction). Use `>=` at the cut-over, tested at the instant and one second before (as planned).
11. **SC9-11 — Sync runs (O-3 b).** Read once per request (not per row), newest first, cap 100 with `reachedLimit` surfaced. A run is listed under a row when its time falls in [`created_at` (or the beginning, if null), `replacedOn` (or now)], at most 10 per row with "and N more". Words: "Sync ran on {UTC} (all models; no per-model record; it may or may not have changed this price)". Only rows with no provenance get them; never applied or runbook rows.

### Adjusted items (marked by SA)
- 2.2 `AdminUserRepository.findEmailsByUserIds`: no longer conditional (BQ-9a decided keep) — SC9-1.
- 2.2 `listAdminPricingSyncRuns`: in scope (O-3 = b) — SC9-11.
- 2.5 response: `auditTruncated` / `syncTruncated` flags; optional `before…Per1m` on audit events — SC9-4, SC9-5.
- 2.8 guards: `ADMIN_METHODS` gains four names; LW-4 image negative control updated — SC9-3.
- 2.4 `replacedOn` rule replaced — SC9-6.

### Optimisation Suggestions (non-blocking)
- O-9 static footnote on deleted prices.
- Reuse the table's status words for the history chips where they mean the same thing (the table calls a shadowed row "superseded"; the history's "Stored, not charged" is clearer — consider aligning the table later, not in this slice).
- Pass an `AbortSignal` / deadline to the repository reads as the AI-activity reads do, if trivial.

### Approval
[x] Workplan approved with conditions SC9-1..SC9-11 — proceed to implementation from T-0; return to SA only if an SC9-9 stop rule fires, otherwise at code review.

### Code review

**Code Review by SA — 2026-10-18** (worktree `neuronforge-model-pricing-s9`, uncommitted diff on `f7429b57`; `origin/main` re-fetched, unchanged)
**Status:** 🔄 APPROVED WITH FIXES (CR9-1..CR9-5). No second SA pass is needed: the Dev applies the fixes, QA re-runs the touched suites, and TL confirms CR9-4.

Targeted run by SA: 22 suites / 450 tests pass (pricing-research history + comparison + LW guard, the repository suites, `adminReadMethods.guard`, the history route, all of `app/admin/system-config`).

**SC9 conditions**

| # | Met | Evidence |
|---|---|---|
| SC9-1 | ✅ | `AdminUserRepository.findEmailsByUserIds`: `user_id, email`, chunks of 50 after de-dup, no `is_active`, empty → no query, counts-only logs, header paragraph; tests in `priceHistoryReads.test.ts` |
| SC9-2 | ✅ with CR9-2 | One de-duplicated lookup; a failed lookup throws → 500 (tested); "not on the admin list"; system ids. The null-id branch is CR9-2 |
| SC9-3 | ✅ | Six names in `ADMIN_METHODS` (four required + both recommended); LW-2 lists and the LW-4 image negative control updated; method-count pins in both repository tests |
| SC9-4 | ✅ | Numbered header, exported column constants (no hash/email/ip/agent, tested), `AUDIT_EVENTS` filters, empty / over-cap / non-UUID refused before any query, `reachedLimit` → `auditTruncated` / `syncTruncated` → drawer notices |
| SC9-5 | ✅ | Lenient `safeParse`, number via `decimalFromNumberLiteral`, `isPlainDecimal` strings, "values not recorded"; `readStoredDecimal` guards every `parseDecimal`; NaN → null + warn with row id; all six test shapes present |
| SC9-6 | ✅ | `priceHistory.ts:453–467`, five cases tested; D-2 refinement accepted |
| SC9-7 | ✅ | `cachedNote` mirrors `comparisonModel.ts:266–272`; `storedAsZero` keeps `current`; parity test covers zero-priced and non-OpenAI-cached rows |
| SC9-8 | ✅ | `isHistoryQueryable` is the query schema itself; `URLSearchParams`; schema import pin plus a one-level check of its two imports |
| SC9-9 | ✅ | §9; register row 118 / census 111 = 105 + 6 + 0 re-checked against the diff |
| SC9-10 | ✅ | Reference by row id, then time; null `created_at` and image rows never R; `>=` tested at the instant and −1 s |
| SC9-11 | ✅ | One read per request, only when a legacy row exists; cap 100 + flag; 10 per row + "and N more"; never under applied / runbook rows (tested) |

**CLAUDE.md:** repositories only (route injects deps; builder is pure; no Supabase call outside `lib/repositories/`) ✅ · user scoping: every new read is on the platform catalogue / admin list / platform audit, each header states why it is not `user_id`-scoped and that only `app/api/admin/**` calls it (enforced by the walk) ✅ · Zod strict query + repeated-key 400 before any read; response schema `.strict()` end to end ✅ · Pino everywhere, `clientLogger` in the browser read, no `console.*` in any touched file ✅ · `requireAdmin` first statement (only the correlation id precedes it, the house pattern), `test:authz-guard` green, register row 118 ✅ · no model name hardcoded outside test fixtures ✅ · rule 7: no new pattern (route-injected deps = `ai-activity`; `useDrawerResource`, `AdminDrawer`, `readAdminResponse` reused) ✅.

**Exact decimals:** `::text` in both live reads (the same casts as `listActiveExact`), `decimal.ts` only, `decimalText` regex in the response schema refuses a JSON number (tested), the drawer prints the string, source scan bans `Number(` / `parseFloat(` / `parseInt(` / `toFixed(` in builder and body. The only numbers are counts (`line_count`, Sync counts via `Number.isSafeInteger`). ✅

**No read can write:** the five new repository methods are `select` only; GET route, no audit row, no RPC; LW-1/2/3/5 green and unchanged in substance. ✅

**Guard edits:** deliberate and minimal — list entries, the LW-4 fixture string, the T-14 and help pins inverted (not deleted), a new source describe. ✅ (CI time: CR9-3.)

**Rulings on Dev's asks**

- **F-1 (`provider === 'openai'`):** accepted. Not a model name and not plugin logic: it states a fact of the charging code (`openaiProvider.ts` is the only caller of `calculateCostWithCachedSync`), copied verbatim from the already-approved `comparisonModel.tokenCurrent`, so the two admin views cannot disagree today. Drift risk noted under Optimisation.
- **O-9 footnote:** accepted, wording fix in CR9-5.
- **Applied branch test-only:** adequate for the builder: A1 (all three margin states, override, manual / fetch, deactivated admin's email), A2 both ways with no fall-through, Apply-retired predecessor, provenance-with-cleanup-date, and `loadPriceHistory` wiring (lines → batches → names, no audit / Sync read). What offline tests cannot prove is that PostgREST resolves the `ai_price_proposals(source_kind)` embed in `APPLIED_LINE_HISTORY_COLUMNS`; only the lines' single FK exists (`20261066` l.59) so it should, but the first real Apply is slice 12 — hence CR9-4, a one-off read-only check now.

**Deviations:** D-1 ✅ (structured actor is better than server-built words) · D-2 ✅ (correct catch) · D-3 ✅ · D-4 ✅ · D-5 ✅ (full C-1 rule is right) · D-6 ✅ · D-7 ✅ · D-8 ✅ · D-9 ✅ · D-10 ✅ · D-11 ✅.

**QA low items (via TL):** (1) → CR9-1. (2) → CR9-2 (it is reachable: `audit_trail.user_id` is `REFERENCES auth.users ON DELETE SET NULL`, so a deleted admin's old events read as "system"; the applied-line path at :378 is unreachable under the `20261066` l.98–103 CHECK but the same fix covers it). (3) accepted as-is: the DB CHECK (`left(source_url, 8) = 'https://'`, `20261066` l.87) plus `pendingLineSchema` is authoritative and `PriceRowCells.tsx:216` renders the same column the same way; optional guard listed under Optimisation.

### Code Review Comments
1. **CR9-1** `lib/ai/pricing-research/priceHistory.ts:485` — "replaced" is chosen by `index > 0`, so a retired row whose only newer row starts later reads "Replaced by the newer price above" while `replacedOn` is its retirement date. Fix: hoist `successorDate` out of the `if` block (it is already computed for `retired` rows) and use `else if (successorDate !== null) retirement = { kind: 'replaced' }`, else `no_record`. Add one test: retired row + starts-later sibling → `no_record`. — Priority: Low
2. **CR9-2** `lib/ai/pricing-research/priceHistory.ts:205` — `!id` returns `system`, inventing an actor (K-1) for events whose ids were nulled by `ON DELETE SET NULL`. Fix: add `z.object({ kind: z.literal('not_recorded') }).strict()` to `ActorSchema` (`priceHistorySchema.ts:58–62`), return it from `actorFor` when `id` is null/empty and `systemFlag` is false (`system` stays only for `systemActorIds` or `details.system_action === true`), word it in `HISTORY_WORDS` (`actorNotRecorded: 'not recorded'`) and in `actorWords` (`PriceHistoryDrawerBody.tsx:37–40`). Test: event with `actor_id` and `user_id` null → `not_recorded`; null with `system_action: true` → `system`. — Priority: Medium
3. **CR9-3** `lib/repositories/__tests__/adminReadMethods.guard.test.ts` (the `it.each(ADMIN_METHODS)` body, ~l.526–534) — each method re-reads and re-strips the whole tree; the six new names add ~9 s locally (~1.3–2.3 s each), against the standing "no added CI time" rule. Fix: build the comment-stripped `{ file, code }` list once (non-`__tests__` files) in the `describe` scope and test each pattern against it; no change to what is pinned. This makes the suite faster than on `main`. — Priority: Medium
4. **CR9-4** (verification, no code) `lib/repositories/AiPriceProposalRepository.ts:88–91` — before merge, TL runs one read-only call against production: `aiPriceProposalRepository.findAppliedLinesByIds([<random v4 uuid>])` (or the equivalent PostgREST GET with the `APPLIED_LINE_HISTORY_COLUMNS` select and `id=in.(<uuid>)`) and confirms `{ data: [], error: null }` (relationship resolution happens before rows are read, so an empty table still proves the embed). Record the result in §9. If it errors (PGRST200/201), return to SA. — Priority: Medium
5. **CR9-5** `app/admin/system-config/priceReviewCopy.ts` `HISTORY_WORDS.deletedFootnote` — "the audit trail page shows deletions" overclaims (pre-2026-09-20 deletes may be unrecorded, AB-5; older ones may be archived). Fix: "Prices deleted before 2026-10-16 are not listed here; the audit trail page shows any recorded deletion." Update the render pin if it matches the old text. — Priority: Low

### Optimisation Suggestions
- `HISTORY_WORDS.truncated` hardcodes 200: build it from `HISTORY_ROW_LIMIT` (already client-safe).
- F-1 drift: a later slice could export one `chargesStoredCachedRate(provider)` used by both `comparisonModel` and `priceHistory`, so a second provider adopting cached charging changes one place.
- QA (3): optionally render `sourceUrl` as a link only when it starts with `HTTPS_PREFIX` (from `pendingLineSchema`, already client-safe), plain text otherwise.
- `AiModelPricingRepository.ts`: missing blank line before the `listHistoryExact` JSDoc (style).
- Empty state for an image model whose basis is `image_setting` prints no basis sentence; fine today, worth a word if image histories get used.

### Code Approved for QA: Yes — conditional on CR9-1..CR9-3 and CR9-5 applied with their tests green, and CR9-4 recorded by TL before merge.

---

## QA Testing Report

**QA — 2026-10-18**
**Test mode:** full
**Strategy used:** A (Jest unit: builder, schemas, repositories with a recording client) + B (route integration with mocked deps and the real builder) + source/guard scans + code reading for edge cases. No live database or browser run: the view is read-only, production has 0 lines and 0 batches, and the applied branch can only be proven by fixtures until the first real Apply (slice 12).
**Focus:** api, schema, security, ui (render level)
**Skipped:** manual browser check (no running app in this session; the page wiring is covered by the render test). `npm run test:bos-entitlements` not run: the diff imports nothing from `lib/business-os/entitlements/` (the only textual match is the admin register doc).
**Input source:** TL prompt (QA judgment on the strategy)

### Test runs (each run once)

| Run | Result |
|---|---|
| `npx jest app/admin/system-config app/api/admin/model-pricing lib/ai/pricing-research lib/repositories/__tests__ lib/audit/__tests__` (includes `adminReadMethods.guard`, `livePriceWrites.guard`, all new suites) | 164 suites: 163 passed, 1 failed; 3594 tests: 3588 passed, 6 failed. The 6 failures are all in `openaiPricingAdapter.test.ts` (known local CRLF failures, untouched by this slice) |
| `npm run test:authz-guard` | 2 suites, 203 tests, all passed |
| New QA suite `lib/ai/pricing-research/__tests__/priceHistory.qa.test.ts` (added by QA, tests only) | 13 passed |

### Required coverage

| Item | Result | Where |
|---|---|---|
| Route happy path (token, image grouping, empty history = 200 with no units) | ✅ PASS | `history/__tests__/route.test.ts` |
| Route 401 and 403 before the query is read and before any repository call | ✅ PASS | route test (`anyRead()` false) |
| Route 400: missing kind, unknown key, provider not in list, bad model id, repeated key, no query | ✅ PASS | route test + `priceHistorySchema.test.ts` (unknown kind, `%`, over-long) |
| Route 500 generic words, no detail outside development, for a row read failure and for the email lookup failure (SC9-2) | ✅ PASS | route test |
| No admin uuid in the response; no audit row written | ✅ PASS | route test |
| One test per new repository method (`listHistoryExact` x2, `findAppliedLinesByIds`, `findBatchesByIds`, `findEmailsByUserIds`, `listAdminPricingRowEvents`, `listAdminPricingSyncRuns`) incl. columns with `::text`, order, cap+1, chunking at 50, empty = no query, non-UUID refused, error returned not thrown | ✅ PASS | `priceHistoryReads.test.ts` |
| Builder: applied line (batch not needed / open / done, override reason, manual vs fetch) | ✅ PASS | `priceHistory.test.ts` A1 |
| Builder: applied but record unreadable (line absent, line not applied), never falls through | ✅ PASS | A2 |
| Builder: runbook row `549fcc6e…` at the exact instant, one second before, never image, never null `created_at` | ✅ PASS | R |
| Builder: slice 2 clean-up retired 2026-10-11 (only without provenance; same-date sibling = never charged) | ✅ PASS | retirement block |
| Builder: pre-review with audit events (created / updated from-to / zero_set, newest first, as recorded) and pre-review no record | ✅ PASS | P1 / P2 |
| Builder: Sync runs capped at 10 per row + "and N more", only legacy rows, not after the replacement day | ✅ PASS | Sync block |
| `auditTruncated` / `syncTruncated` / `truncated` surfaced and shown | ✅ PASS | repository tests + render test |
| `neverCharged`, `cachedNote` (OpenAI-only rule, 5 cases), `storedAsZero` (incl. input-only model) | ✅ PASS | builder + render tests; parity in `comparisonModel.test.ts` |
| Unreadable stored value never throws | ✅ PASS | builder test + QA suite (NaN, Infinity, -Infinity, empty, exponent text) |
| Names: email, deactivated admin's email (BQ-9a), not on the admin list, system (SYSTEM id, all-zero id, `system_action`) | ✅ PASS | builder test; repository test proves no `is_active` filter |

### Edge cases hunted (code reading + QA suite)

| Edge | Result |
|---|---|
| No float in the price path: `::text` casts in both repositories; `decimal.ts` BigInt shift for per 1M; no `Number(` / `parseFloat` / `toFixed` in any new file; schema refuses a number | ✅ PASS |
| Tiny values: `0.000000000000003` per token prints `0.000000003` per 1M; legacy audit `3e-15` (JSON number) prints the same; `0.0000001` prints `0.1` (float would be `0.09999999999999999`) | ✅ PASS (QA suite) |
| Same-day applies: three rows on one date, newest `created_at` charged, the others `not_charged` + `neverCharged` | ✅ PASS (QA suite); repository order equals `listActive()` (`effective_date DESC, created_at DESC`) |
| Image grouping by size then low/medium/high then other qualities alphabetically; retired row stays in its unit | ✅ PASS (QA suite) |
| Image row priced 0 or unreadable is never the charged row (`selectActiveImagePrices`) | ✅ PASS |
| Email lookup failure → 500 (no silent "not on the list") | ✅ PASS |
| Non-UUID ids refused before any query (audit, lines, batches); `ai_model_pricing.id` is `uuid` so a real row cannot trip it | ✅ PASS |
| Upper-case audit `entity_id` still attaches to its row (builder lower-cases both sides) | ✅ PASS (QA suite) |
| History button hidden with no provider or a name failing `MODEL_ID_REGEX` (`isHistoryQueryable`, the query schema itself); model ids can hold no `:` so the drawer key split is safe | ✅ PASS (unit for bad name; render test for `provider: null`) |
| Client schema file imports only `zod`, `officialSources`, `pendingLineSchema` (→ `bounds`); no server import; `priceHistory.ts` carries `server-only` | ✅ PASS |
| No backslash in any new file (Tailwind escape rule) | ✅ PASS |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. Every read is bounded (200 rows, 200 events, 100 Sync runs, chunks of 50); no read when not needed (lines only for applied rows, audit and Sync only for legacy rows).

#### Edge Cases (nice to fix; none reachable with today's writers)
1. **"Replaced by the newer price above" when the only newer row starts later** — `lib/ai/pricing-research/priceHistory.ts:485`. The retirement rule uses `index > 0` (any newer row), while `replacedOn` (lines 458–465, SC9-6) correctly skips a starts-later successor. A row retired with only a future-dated row above it would say it was replaced by a price that has not started. Unreachable today (Apply and the runbook insert with today's date). Severity: Low.
2. **A null audit actor, or an applied line with null `decided_by` and no batch, is shown as "system"** — `priceHistory.ts:205` (`!id` → system), reached via lines 332, 378, 412. SC9-2 names only `SYSTEM_ADMIN_USER_ID` / the all-zero id / `details.system_action` as "system"; an event with no actor is unknown rather than the platform. Declared in §10 (SC9-2 row), so for SA to confirm; `decided_by` is always set by the apply function. Severity: Low.
3. **Source URL rendered as a link without a scheme check** — `PriceHistoryDrawerBody.tsx:81`. The value is admin-entered and validated by `isOfficialSourceUrl` at entry, so not exploitable today; a render-side `https:` check would be defence in depth. Severity: Low.

### Test Outputs / Logs

```text
Test Suites: 1 failed, 163 passed, 164 total
Tests:       6 failed, 3588 passed, 3594 total   (all 6 in openaiPricingAdapter.test.ts, known CRLF)
test:authz-guard: Test Suites: 2 passed; Tests: 203 passed
priceHistory.qa.test.ts: Tests: 13 passed
```

### Final Status
- [x] All acceptance criteria pass — ready for commit (pending SA code review). No High or Medium issue open; three Low edge cases recorded for SA/Dev discretion.
- [ ] Issues found — Dev must address before commit

**Verdict: Ready for commit.** QA added one test file (`lib/ai/pricing-research/__tests__/priceHistory.qa.test.ts`, tests only); no source file edited.

### Re-pass after SA code review fixes (QA — 2026-10-18)

| Run (once each) | Result |
|---|---|
| Same targeted suites (now including `priceHistory.qa.test.ts` and `adminReadMethods.guard`) | 165 suites: 164 passed, 1 failed; 3610 tests: 3604 passed, 6 failed (all 6 in `openaiPricingAdapter.test.ts`, the known CRLF failures) |
| `npm run test:authz-guard` | 2 suites, 203 tests passed |

| Fix | Pinned by a test? | Result |
|---|---|---|
| CR9-1 "replaced" only with a started successor (retirement now keys on `successorDate`, the same `effective_date ≤ today` search as `replacedOn`) | ✅ `priceHistory.test.ts` "SA CR9-1: … only newer row starts later … no_record"; the Apply-retired and provenance-retired cases still expect `replaced` | PASS. Closes QA edge case 1 |
| CR9-2 `not_recorded` actor; "system" only for `systemActorIds` or `details.system_action === true` | ✅ `priceHistory.test.ts` (both ids null → `not_recorded`; null + `system_action` → `system`); the four-name test still passes; schema adds the strict `not_recorded` kind; render test words it ("not recorded") | PASS. Closes QA edge case 2 (an applied line with null `decided_by` and no batch now also reads "not recorded") |
| CR9-3 guard reads the tree once | ✅ the guard itself, 52 tests | PASS. Compared with `HEAD`: same walk, same `__tests__` exclusion, same comment stripping, same `\.method\(` pattern, same two assertions; only the file reading moved from per-method to `describe` scope. It still catches a violation: a `.listHistoryExact(` call in any non-test file under `app`, `lib`, `components`, `hooks` or `scripts` outside `app/api/admin/` (e.g. `lib/ai/pricing.ts`) would land in `callers` and fail `toEqual([])`. The positive control (`callers.length > 0`, met by the history route for each of the 6 new names) proves the pattern matches real calls, and "scanned a real tree" now also asserts `sources.length > 500` |
| CR9-5 footnote wording | ✅ render test pins the exact new sentence | PASS |
| CR9-4 production embed check | n/a (TL, recorded in §9) | PASS per TL |

Still open: QA edge case 3 (source URL rendered as a link without an `https:` check, `PriceHistoryDrawerBody.tsx`). Low, not reachable today, SA's call.

**Re-pass verdict: Ready for commit.** No source edits by QA.

---

## Commit Info

| Field | Value |
|---|---|
| Branch | `feature/ai-model-price-review-slice9` |
| Commit | `6ff6d9b4` feat(pricing): per-model price history view (price review slice 9) |
| PR | [#464](https://github.com/AgentsPilot/neuronforge/pull/464) (base `main`, merge commit; auto-merge left to TL) |
| Base | `origin/main` `f7429b57` (unchanged at commit time, no merge needed) |
| Migration | None (no file under `supabase/migrations`) |
| RM pre-commit checks | `git diff --numstat` no file with more deletions than insertions; no secrets, no added `console.*`, no backslash-hex in .md/.sql/.txt; `.claude/` and `node_modules` not staged |
| RM test run | Targeted suites (`lib/ai/pricing-research`, `app/admin/system-config`, `app/api/admin/model-pricing`, `lib/repositories/__tests__`, `lib/audit/__tests__`): 165 suites, 3604 passed, 6 failed (known local CRLF failures in `openaiPricingAdapter.test.ts`); `test:authz-guard` 203 passed |
| Committed | 2026-10-18 |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-18 | Committed, PR #464 | RM: commit `6ff6d9b4`, [PR #464](https://github.com/AgentsPilot/neuronforge/pull/464); Commit Info filled. No migration |
| 2026-10-18 | Workplan written | Slice 9 (MP-FR-17, RR-6): read-only history route, five new read methods (two live repositories, lines, batches, audit) plus one optional per BQ-9a, pure builder with the who-and-why precedence (applied / record missing / runbook / pre-review with audit / no record) and retirement words (clean-up 2026-10-11 / replaced / no record), History button opening the shared drawer. No migration (index on `proposal_line_id` confirmed from `20261066`). Open questions O-1..O-10; business question BQ-9a. No code |
| 2026-10-18 | SA code review fixes | CR9-1 (replaced only with a started successor), CR9-2 (`not_recorded` actor), CR9-3 (guard reads the tree once: 21.7–25.4 s to 5.8–7.3 s), CR9-5 (footnote wording) applied with tests; CR9-4 production embed check by TL recorded in §9 (PASS). Suites re-run green except the known CRLF failures. Uncommitted |
| 2026-10-18 | Code complete | SC9-1..SC9-11 and the O-rulings implemented; BQ-9a (keep the email) built as `findEmailsByUserIds`. T-0 recorded in §9 (no stop rule fired; register row 118, census 111 = 105 + 6 + 0, 82 files; `ADMIN_METHODS` 13). Deviations D-1..D-11 in §10. Tasks T-0..T-7 ticked. Uncommitted, awaiting SA code review and QA |
