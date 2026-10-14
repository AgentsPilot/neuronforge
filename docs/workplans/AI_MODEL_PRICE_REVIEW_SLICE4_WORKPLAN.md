# Workplan: AI Model Price Review, Slice 4 (comparison page)

> **Last Updated**: 2026-10-14

**Developer:** Dev
**Requirement:** [AI_MODEL_PRICE_REVIEW_REQUIREMENT.md](/docs/requirements/AI_MODEL_PRICE_REVIEW_REQUIREMENT.md): §8a flow and UF-5 (one table), UF-6 (B-2); UF-2 colours; MP-FR-2, -3, -4, -12 as amended; MP-NFR-8; RR-3; RR-4; R-9 row 4; user decision "not used yet"; BQ-3; slice 2 QA follow-up (retired rows)
**Branch:** `feature/ai-model-price-review-slice4` (worktree `neuronforge-model-pricing-s3`, off origin/main `392a9b53`)
**Date:** 2026-10-14
**Status:** Code Complete, uncommitted; awaiting SA code review. One-table revision SA-approved 2026-10-14 with NR-1..NR-5 (folded in below); N-1..N-5 approved as proposed (N-3 corrects RC-3: line 203 changes). Implementation notes and deviations in 10.1.

## Overview

Slice 4 turns today's Model pricing table into the comparison (user decision UF-5: **one table, no separate section**). Each model row shows, per unit and per 1M, our price next to the newest pending provider price with the % gap, a status chip that always carries words, the Business OS areas using the model, flags in words, and the source link with the checked date. An "Enter provider price" button on every row and above the table opens a manual-entry form on the existing route. Retired rows are labelled. Sync and per-row Edit stay until slice 6. **UI only:** no new route, no migration, no charging change. No Apply (slice 8), no automatic check (slice 5), no history (slice 9); the page says so.

## Table of Contents

1. [Analysis](#1-analysis) · 2. [The single table](#2-the-single-table) · 3. [Manual entry](#3-manual-entry) · 4. [Flag words (RC-3)](#4-flag-words-rc-3) · 5. [Files](#5-files) · 6. [Tests and CI](#6-tests-and-ci) · 7. [SA conditions, adapted](#7-sa-conditions-adapted) · 8. [New open questions for SA](#8-new-open-questions-for-sa) · 9. [Risks](#9-risks) · 10. [Task list](#10-task-list) · 11. [Manual QA checklist](#11-manual-qa-checklist-user-browser-after-deploy) · [SA Review Notes](#sa-review-notes) · [QA Testing Report](#qa-testing-report) · [Commit Info](#commit-info) · [Change History](#change-history)

---

## 1. Analysis

| Fact (read on `392a9b53`) | Consequence |
|---|---|
| `GET /api/admin/model-pricing/comparison` returns `rows[]` with `kind`, `provider`, `modelName`, `areas`, `usageLabel`, `currentBasis`, `units[]` (`unit`, `current`, `pending` as **per-1M or per-image decimal strings**, `colour`, `status`, `gapBasisPoints`, `label`), `colour`, `redUnits`, `summary`, `worstGapBasisPoints`, `pending[]` (source, checked date, flags, `flagLabels`, creator). Active prices only; no row id, no effective date, no retired rows | It cannot alone drive Edit (needs the row id) or the retired labels |
| `GET /api/admin/system-config/pricing` (`listAll`, `select('*')`) returns every row with `id`, `effective_date`, `retired_date`; prices as JSON numbers (per token) | It stays the source of the row id, dates and retired rows, never of a displayed price |
| `TokenCurrent.rowId` is computed inside `comparisonModel.ts` but not returned | One additive field joins the two reads by id (N-1) |
| `coverageColour.ts` keeps `gapText` private; `formatGapPercent` alone prints "0.00%" for a red unit under 1 bp | Export a pure `unitGapText(unit)` so a gap cell never shows a red unit as "0.00%" (N-2) |
| `comparisonModel.test.ts:202-203` expects `flagLabels` to hold only `new_model` for a line flagged `new_model` and `cached_input_listed` | RC-3's full label record makes that line return two labels, so line 203 **must** change (N-3) |
| `source.guard.test.ts` pins Sync's handler and button byte for byte (S-9, S-10), S-1 subtitle, S-4 paragraph, counts `'/api/admin/system-config/pricing'` = 2, `handleEditPricing(model)` = 1, `handleSavePricing(model.id)` = 1, `onClick={handleCancelEditPricing}` = 1, `onClick={handleSyncPricing}` = 1 in `page.tsx`, bans `/api/admin/boost-packs`, `boost`, `immediately`, `per 1,000` | All kept as they are (6.3); the comparison URL lives in a helper file, not `page.tsx` |
| `pages.render` and `pages.edge.qa` pin exact call lists and per-token texts ("$0.00000015", "$0.075 per 1M" from a float) | The table itself changes, so those assertions change (6.2, SA approval) |
| The page has Edit and Sync only: no Add or Delete control (the route's POST and DELETE are unused, F-79) | "Keep Edit/Delete" means keep Edit; nothing else exists |
| L-11 (layout migration of this page) waits on the price review; the page is not in the migrated-pages registry | Chips from `StatusChip`; the rest of the page's chrome stays for L-11 |

Skills: no route, repository, service-role write, AI call or entitlements import, so `new-api-route`, `new-repository`, `tenant-isolation-guard`, `bos-llm-call-standards`, `business-os-entitlements` do not apply. `console.*` in `page.tsx`: 0.

---

## 2. The single table

### 2.1 Two reads, one row list

`fetchData()` reads **both** routes in parallel. The comparison is the single source of every **displayed price, gap, status, area and flag**; the pricing list supplies only the row id (for Edit), the effective date and retired rows. Joining is a pure helper, `buildPriceTableRows(tableRows, comparison)`:

| Row kind | Comes from | Shows | Edit |
|---|---|---|---|
| Compared row | Each comparison row; joined to its pricing-list row by `currentRowId` (N-1) when `currentBasis` is `table` | Everything in 2.2 | Yes, on the joined row (unchanged handler) |
| Comparison-only row | In-code fallback, unpriced, image or pending-only models | Everything in 2.2; basis in words | No (there is no row to edit) |
| Retired row | Pricing list, `retired_date` set | Model, `StatusChip tone="neutral"` "Retired " + `formatUtcDate(retired_date)`; price cells "—" (history is slice 9) | No (RC-4) |
| Starts later (NR-1) | Pricing list, not retired, not joined, `effective_date` after the server date (`generatedAt` of the comparison reply, never the browser clock) | Model, neutral chip "Starts <date>", price cells "—" | Yes (it will be charged) |
| Superseded (NR-1) | Pricing list, not retired, not joined, `effective_date` on or before the server date | Model, neutral chip "Superseded by a newer row, not charged", price cells "—" | No (editing it changes nothing charged) |

**Either read failing fails the table**, with the page's existing banner "Could not load model prices." and the existing failure line, and clears rows and any open editor (C2-4, O-5). A table half from one read and half from another would show prices with no status, which is worse than none. The log says which read failed.

**After a save:** the row is updated from the PUT reply as today (W2-1), then the comparison is read again silently so "ours" shows the saved price exactly (one extra GET; N-5). While it runs the table wrapper carries `aria-busy`. If that re-read fails, the success message stays and the table follows N-4: rows cleared, banner shown (NR-2). **After Sync:** the pinned handler calls `fetchData(true)`, which now reads both. **After a manual entry:** `fetchData(true)`.

### 2.2 Columns (user sketch)

| Column | Content |
|---|---|
| Model | Model id (mono) and provider; "images" for an image model |
| Used by | Area tags as neutral chips ("(off)" when switched off), or "not used by Business OS" |
| Input /1M: ours · provider · gap | `$` + the server strings, no arithmetic; "—" when absent. Ours carries its basis in words when not stored ("built-in fallback", "not priced"). Gap from `unitGapText` (N-2) |
| Output /1M: ours · provider · gap | Same |
| Status | `StatusChip`: `danger` "Undercharging" with `summary` beside it ("Undercharging: input -9.09%", red units named); `ok` "Covered"; `unknown` "No new price" (nothing pending), or "New model" when the pending line carries `new_model`, else "Not compared". Flags in words below (section 4) |
| Source | "Provider page" link (RC-9), "Checked YYYY-MM-DD", "Entered by <email>"; "—" when nothing is pending |
| Actions | "Enter provider price" (pre-fills the form); Edit where 2.1 allows |

The thead has two rows: the unit groups ("Input /1M", "Output /1M") with `scope="colgroup"`, then "ours", "provider", "gap" per group with `scope="col"` (NR-5). While a row is in Edit, both inputs carry the visible unit "per token" (NR-4); the editor and its handlers are otherwise untouched.

**Cached input (a sub-line, NR-5).** Under the Input cells, a second line "cached: ours · provider · gap" appears only when either side has a value, with the basis in words when it is not stored ("derived: half of input"). A third pair would add three mostly-empty columns to every row.

**Image models (one row per model, NR-5).** The six price cells merge into one `colSpan={6}` cell holding a `<ul>`, one line per size and quality: "1024x1024 high, per image: ours $0.25 · provider $0.04 · +525.00%". Status and the rest stay per model, so the worst unit still sets the chip.

**Above the table:** a bar with the "Enter provider price" button and the labelled Sort `<select>`: **Recommended** (the server's order: red first), **Most undercharged first**, **Furthest above provider first** (highest unit gap from `units[].gapBasisPoints`; null last; ties by provider, null as `''`, then model). Retired and not-in-effect rows always go last. Then the always-shown muted note: "Nothing in the provider column is charged yet. Applying a new price, checking provider prices automatically, and each model's price history come in later releases. Until then, Sync and Edit still change live prices directly." When nothing is pending, an `AdminNotice`: "No provider prices entered yet, so every row reads No new price. Use Enter provider price to add one."

**States:** first load keeps the page's spinner; the read failure as in 2.1; both lists empty: the table header with one line "No models to show." (the existing empty-list case stays a table); a refresh keeps rows on screen.

**Text above the table.** S-1 (card subtitle) and S-4 (Sync paragraph) stay byte-identical. The info box's Input and Output paragraphs, which describe the old per-token figure "with the per 1M under it", are reworded: "Shown per 1M tokens, the figure providers publish. The table stores cost per token, and the Edit field still takes the per-token value." MT-2 ("in effect on all servers within 1 hour") stays in the Manual Edits paragraph. The existing collapse toggle gains `aria-expanded` and `aria-label` (RC-7, adapted).

---

## 3. Manual entry

Unchanged in substance from the approved version: Kind radios in a `<fieldset>`; Provider `<select>` from `PRICE_PROVIDERS` (left unselected and required when pre-filled from an image row with provider `null`, O-8); model id; per-1M text prices (cached optional) or image size, quality and price; official source URL with the allowed hosts listed under it; Checked on (local calendar date by default). The line passes `PendingLineSchema` in the browser first (O-6, RC-1), then POSTs `{ lines: [line] }`. 400 and 422 show the route's `error` and each `problems[].message` with its field name (read through `readJsonBody`); 409, 403 and 500 show the route's `error`; a non-JSON body and a rejected fetch get fixed words. Values stay after a refusal. Success: `role="status"` line "Saved as a pending price. No charge changes until it is applied.", the returned flag codes in words through `FLAG_LABELS`, "replaced an earlier pending price" when `supersededLineId` is set; the form closes and the table re-reads. It opens from the bar's button (empty) or a row's button (pre-filled with provider, model, kind).

---

## 4. Flag words (RC-3)

`FLAG_LABELS` in `lib/ai/pricing-research/lineFlags.ts` becomes a full `Record<PendingLineFlag, string>`. "Needs a reason to apply" is derived from `BLOCKING_FLAGS` where shown, so it is not part of the stored label except where noted. This changes the comparison read's output (more `flagLabels` entries) and no charge.

| Flag | Label | Blocking |
|---|---|---|
| `new_model` | not used yet | |
| `large_move` | price moves more than 50% | yes: "needs a reason to apply" |
| `above_conservative_rate` | above the rate we charge for an unknown model | |
| `fallback_differs` | built-in backup price differs; update it by code change | |
| `cached_input_listed` | provider lists a cached-input price | |
| `cross_check_differs` | differs from the second price list by more than 5% | yes |
| `cross_check_unavailable` | second price list could not be read | |
| `cross_check_not_listed` | not on the second price list | |
| `retiring` | provider is retiring this model | yes |
| `renamed` | provider renamed this model | |

---

## 5. Files

| File | Action | Purpose |
|---|---|---|
| `app/admin/system-config/page.tsx` | modify | `fetchData` reads both (comparison through the helper); the table body renders `buildPriceTableRows`; bar, note, notice, form mount; save re-reads the comparison; info-box wording; toggle aria. **Sync handler and button untouched**; the four counted literals stay once each |
| `app/admin/system-config/priceComparisonRead.ts` | create | `readPriceComparison()`: the one comparison `fetch`, through `readAdminResponse`. Keeps every `/api/admin/model-pricing/…` string out of `page.tsx` |
| `app/admin/system-config/priceTableRows.ts` | create | Pure join and sort (2.1, 2.2) |
| `app/admin/system-config/components/PriceRowCells.tsx` | create | The new cells of one row (prices, cached sub-line, image list, status, flags, source) |
| `app/admin/system-config/components/ManualPriceEntryForm.tsx` | create | Section 3; its POST lives here |
| `app/admin/system-config/priceReviewCopy.ts` | create | Every new string except flag words |
| `lib/ai/pricing-research/lineFlags.ts` | modify | Section 4 |
| `lib/ai/pricing-research/coverageColour.ts` | modify (N-2) | Export `unitGapText(unit)`; existing exports unchanged |
| `lib/ai/pricing-research/comparisonModel.ts` | modify (N-1) | Add `currentRowId: string | null` to `ComparisonRow` (the stored row behind `current`; null unless basis `table`) |

Charging files untouched: `git diff origin/main --stat -- lib/ai/pricing.ts lib/business-os/llm/chargePricing.ts lib/ai/providers lib/services lib/repositories app/api` is empty; `chargingUntouched.guard.test.ts` green unedited.

---

## 6. Tests and CI

### 6.1 New suites

| Suite | Covers |
|---|---|
| `__tests__/priceTable.render.test.tsx` (jsdom, URL-router stub, renders the page) | **T-1 (replaces RC-5): a joined row shows ours, provider and gap per unit** ("gpt-4o-mini": input ours 0.15, provider 0.15, 0.00%; output likewise) inside the one table, and there is exactly one `<table>`. T-2 red row: chip `textContent` "Undercharging", summary names the unit, gap "-9.09%"; a sub-1 bp red gap reads "less than -0.01%". T-3 green above provider "+35.00%". T-4 grey "No new price" with ours still shown exactly ("$0.075", never "$0.08"). T-5 "New model" and "not used yet". T-6 "Not priced". T-7 areas, "(off)", "not used by Business OS". T-8 flag words and "needs a reason to apply". T-9 cached sub-line present only with a value; image row lists its units. T-10 source link only for an allowed host (RC-9); off-list host and non-https render no link; "Checked 2026-10-14". T-11 retired row: "Retired 2026-10-11", no Edit; not-in-effect row keeps Edit; comparison-only row has no Edit. T-12 sort modes. T-13 comparison read fails (500, `success: false`, reject): banner, failure line, no table. T-14 no Apply, Dismiss, Check, Fetch or History button; muted note present; toggle `aria-expanded`. T-15 a save re-reads the comparison and shows the saved price |
| `__tests__/manualPriceEntry.render.test.tsx` | M-1..M-7 as approved (client refusals post nothing and set `aria-invalid`; exact body with strings; 400 / 422 problems with field names; 409, 403, network; success words, flags, re-read; values kept; save disabled while saving) |
| `__tests__/priceTableRows.test.ts` | Join by `currentRowId`, comparison-only rows, retired and not-in-effect rows last, sort modes, null gaps last, stable ties |
| `__tests__/priceReview.source.test.ts` | RC-1 value imports allow-list (now including `coverageColour`, N-2), RC-2 `import type` only from `comparisonModel` / `areaTags`, RC-8 bans in the new files, `console.` banned, `clientLogger` used; the comparison URL appears only in `priceComparisonRead.ts` and the manual-entry URL only in the form |

### 6.2 Edits to existing suites (approved by SA, NR-3; none is a guard)

Each edited case keeps its original intent, stated in a one-line comment. R-2, R-3 and R-4 keep their assertions verbatim. No assertion on a PUT or Sync request body is weakened; R-9 still asserts the per-token PUT body and its name drops "with no extra read" (N-5). New case R-13 (NR-2): a save whose comparison re-read fails keeps the success message and clears the table.

| Suite / case | Edit | Why |
|---|---|---|
| `pages.render` shared stub | Every case answers the comparison URL (a fixture matching `ROWS`) | The page now reads it |
| R-1 | Call list becomes the set {GET pricing, GET comparison} | Two reads |
| R-2, R-3, R-4 | Unchanged assertions; the stub answers the comparison | Pricing failure behaves as before |
| R-5, R-10 | Call lists add a GET comparison after each pricing GET | `fetchData` reads both |
| R-9 | Texts become per-1M from the comparison fixture; calls [GET p, GET c, PUT p, GET c] | Displayed price comes from the comparison; save re-reads it |
| R-11 | Rewritten: the comparison string "0.075" shows as "$0.075", never "$0.08" | Same precision proof, now on the server text |
| Empty list | Both reads empty: table plus "No models to show." | Two sources |
| New R-12 | Retired row label and no Edit (RC-4) | — |
| `pages.edge.qa` E-1, E-2, E-3 | Router answers the comparison; per-token texts become per-1M from the fixture; E-2 call list adds the comparison re-read after each PUT | Same reasons |
| `lineFlags.test.ts` | Add: every flag has a non-empty label | RC-3 |
| `comparisonModel.test.ts` | **Line 203 changes** to two labels (N-3); add `currentRowId` cases (N-1) | RC-3 as written cannot leave it unchanged |
| `coverageColour.test.ts` | Add `unitGapText` cases | N-2 |

### 6.3 `source.guard.test.ts`: **no change**

S-9 and S-10 (Sync handler and button) stay byte-identical: the handler is not edited and the new bar sits above the table, not beside the button. S-1, S-4, S-5..S-7, G-8, MT-1, MT-2 hold. W2-4: `'/api/admin/system-config/pricing'` stays twice (the GET in `fetchData`, the PUT), `handleEditPricing(model)` and `handleSavePricing(model.id)` once each (the joined row's pricing-list object keeps the name `model`). G-1, G-2: no new `/api/…` string in `page.tsx`.

### 6.4 Commands and CI

```bash
npx jest app/admin/system-config lib/ai/pricing-research --ci
npx jest app/admin/components/layout --ci
npm run lint && npm run lint:hooks
npx tsc --noEmit -p tsconfig.json
```

All suites run inside the existing Jest gate, jsdom or pure, no network: no new job, script or `package.json` change, **no added CI time**. No new route, so the authz census is unchanged.

---

## 7. SA conditions, adapted

| SA item | In this revision |
|---|---|
| O-1, B-1 | **Superseded** by UF-5 (one table) |
| O-2, RC-5 | **Superseded**: no section to mock and no marker. Replaced by T-1 (ours and provider in the one table) and the 6.2 edits |
| O-3, RC-4 | Kept: neutral chip "Retired " + `formatUtcDate`; Edit behind a condition; the literal once; T-9 records the PUT gap in R-9 row 6 |
| O-4, RC-3 | Kept: section 4 table; tests in 6.2; **line 203 must change** (N-3) |
| O-5, RC-2 | Kept: statement-level `import type` only |
| O-6, RC-1 | Kept: first client-side `zod`, admin-only chunk, narrowly approved. Value imports from `pendingLineSchema`, `officialSources`, `lineFlags`, `bounds`, plus `coverageColour` if N-2 is approved |
| O-7, RC-6 | Done in the requirement: per-provider status moved from R-9 row 4 to row 5 |
| O-8, O-9, O-10 | Kept (row pre-fill; client-side gap sort from server numbers; no registry entry, chips only from `StatusChip`) |
| RC-7 | Kept for the new parts (form labels, fieldset, `aria-invalid`, `role="alert"` / `role="status"`, labelled Sort, focus rings, image units as `<ul>`); the existing collapse toggle gains `aria-expanded` |
| RC-8 | Kept: `Number(`, `parseFloat(`, `parseInt(`, `toFixed(` banned in the **new** files. The existing per-token editor in `page.tsx` keeps its own (slice 6 removes it) |
| RC-9 | Kept: link only when `isOfficialSourceUrl(provider, url)`; `HTTPS_PREFIX` when provider is null |
| Suggestions | Taken: local calendar date default; `''` for a null provider in ties; the notice names the button |

---

## 8. New open questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| N-1 | Join key | Add `currentRowId` to `ComparisonRow` (additive read-model field; no charge). Alternative: join on provider and model, which is ambiguous if two non-retired rows exist for one model |
| N-2 | Gap text per unit | Export `unitGapText(unit)` from `coverageColour.ts` and allow it as a client value import, so the gap cell uses the same rule as the server labels |
| N-3 | `comparisonModel.test.ts:203` | Approve changing it to both labels; RC-3's "unchanged" cannot hold with a full label record |
| N-4 | Either read failing fails the whole table | Approve (2.1); the alternative shows prices without status |
| N-5 | Save re-reads the comparison (one extra GET after a PUT) | Approve; it replaces W2-1's "no extra read" so "ours" is the exact stored price |

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| A float reaches a displayed price | Every displayed price is the comparison's string; RC-8 bans in new files; T-4 and R-11 pin "$0.075" |
| Sync's pinned block is disturbed by the table rework | The handler is not edited; S-9 and S-10 run unchanged |
| The per-token editor sits in a per-1M table | The info box says so; slice 6 removes the editor |
| Colour as the only signal | Every chip has words and an icon; summary names red units (T-2) |
| An admin reads "Covered" as applied | The muted note and the success line say nothing is charged yet |
| The production check leaves a pending line | User accepted (UF-6); a later entry for the same model replaces it; slice 8 brings dismiss |

---

## 10. Task list

- [x] T-0 SA rules on N-1..N-5 and the 6.2 edits
- [x] T-1 `lineFlags.ts` labels, `unitGapText`, `currentRowId`, with their tests
- [x] T-2 `priceReviewCopy.ts`, `priceTableRows.ts` and its test
- [x] T-3 `priceComparisonRead.ts`, `PriceRowCells.tsx`
- [x] T-4 `ManualPriceEntryForm.tsx`
- [x] T-5 `page.tsx`: two reads, merged rows, bar, note, notice, form, retired rows, save re-read, info box, toggle aria
- [x] T-6 New suites; 6.2 edits; `source.guard.test.ts` untouched
- [x] T-7 Commands green; charging diff empty; `git diff --stat` reviewed
- [x] T-8 Requirement status; R-9 row 6 note (RC-4); this workplan's status

---

### 10.1 Implementation notes (2026-10-14)

**Files.** Created: `priceReviewCopy.ts`, `priceComparisonRead.ts`, `priceTableRows.ts`, `components/PriceRowCells.tsx`, `components/ManualPriceEntryForm.tsx`, `__fixtures__/priceComparison.ts` (test fixtures), and the suites `priceTable.render`, `manualPriceEntry.render`, `priceTableRows`, `priceReview.source` (all under `app/admin/system-config/`). Modified: `page.tsx`, `pages.render.test.tsx`, `pages.edge.qa.test.tsx`, `lib/ai/pricing-research/{lineFlags,coverageColour,comparisonModel}.ts` and their three test files. Not touched: `source.guard.test.ts`, `chargingUntouched.guard.test.ts`, every charging file (`git diff origin/main --stat` over `lib/ai/pricing.ts`, `chargePricing.ts`, `lib/ai/providers`, `lib/services`, `lib/repositories`, `app/api` is empty).

**Deviations (SA rules at code review).**

| # | Deviation | Why |
|---|---|---|
| D-1 | After a successful manual entry the form stays open, cleared, with its `role="status"` line, instead of closing | The success words and the flags stay visible while the table re-reads; Close is one click |
| D-2 | "Most undercharged first" breaks a gap tie by the exact colour (red before green) | A red unit under 1 bp rounds to a 0 gap and would otherwise sort beside a green 0 |
| D-3 | Test fixtures live in `app/admin/system-config/__fixtures__/priceComparison.ts` | Any file under `__tests__/` is collected as a suite; the fixtures are shared by four suites |
| D-4 | The old "Effective Date" column and the per-token display (`formatCost`, `formatCostPerMillion`) are gone | Every displayed price is now the comparison's per-1M text (UF-5); dates show in the status chips where they matter (NR-1) |
| D-5 | The rebuilt table takes the shared `ADMIN_TABLE*` classes; the rest of the page chrome is untouched | It is rebuilt anyway; L-11 still owns the header, card and states |
| D-6 | `manualPriceEntry.render` fills fields with `fireEvent.change`, not `userEvent.type` | Typing key by key took over 5 s per case; same change event, no added CI time |

**Not changed, noted.** `eslint` reports two `react/no-unescaped-entities` warnings in `page.tsx` on text that predates this slice ("AI model's input", "Changes don't alter provider billing", the latter beside the pinned MT-2 sentence). `typecheck:bos-llm` reports one baseline entry fixed in `app/api/onboarding/build/route.ts`, a file this slice does not touch.

## 11. Manual QA checklist (user, browser, after deploy)

QA cannot sign in to production.

| # | Step | Expected |
|---|---|---|
| U-1 | Open `/admin/system-config` | One table; each model shows ours, provider and gap for input and output; the muted note above it |
| U-2 | Look at the rows | With nothing pending every priced row reads "No new price"; area tags on the models Business OS uses; any red row reads "Not priced" in words |
| U-3 | Change Sort | Order changes; retired rows stay last |
| U-4 | Find the 12 rows retired on 2026-10-11 | "Retired 2026-10-11", no Edit; active stored rows still have Edit |
| U-5 | Enter a price with an http URL or a host such as example.com | Refused with a message, nothing saved |
| U-6 | Enter gpt-4o-mini's real current price from OpenAI's official page, today's date (UF-6) | "Saved as a pending price…"; the row shows the provider price, the gap and a chip with words; the source link opens the page |
| U-7 | Enter an input price of 2000 per 1M | Refused with the server's message (422); nothing saved |
| U-8 | Look for Apply, Check provider prices or History | None present |

---

## SA Review Notes

> Revision note (Dev, 2026-10-14): the user chose one table (UF-5). O-1, O-2, RC-5 and B-1 below are superseded; every other ruling is carried into section 7.

**Reviewed by SA — 2026-10-14** (worktree `neuronforge-model-pricing-s3`, base `392a9b53`)
**Status:** ✅ Approved with conditions. Implement with RC-1..RC-9 below folded in; no re-review of the workplan needed, they are checked at code review.

### What was verified

| Claim | Verified |
|---|---|
| `pendingLineSchema.ts`, `officialSources.ts`, `bounds.ts`, `decimal.ts`, `coverageColour.ts`, `lineFlags.ts` import nothing server-side | Yes. Their only imports are `zod` and each other (`lineFlags.ts` takes `PendingLineInput` as a type). `comparisonModel.ts` and `areaTags.ts` start with `import 'server-only'` and reach repositories and the charging modules |
| Comparison answers `{ success: true, data }` (fits `readAdminResponse`); manual entry answers `problems[{ path, message }]` on 400 / 422 | Yes. `readAdminResponse` returns only one message, so the form reads `problems` through `readJsonBody` itself, as planned |
| `source.guard.test.ts` can stay unchanged | Yes, if the Edit button keeps the literal `handleEditPricing(model)` exactly once (W2-4) and nothing new in `page.tsx` contains `/api/…`, `boost`, `immediately` or `per 1,000`. The new strings live in `priceReviewCopy.ts`, which no guard scans |
| No charging change | Yes. No file under `lib/ai/pricing.ts`, `chargePricing.ts`, providers, services, repositories or `app/api` is in the file list. `lineFlags.ts` (O-4) is under `lib/ai/pricing-research/`, so `chargingUntouched.guard.test.ts` covers it and must stay green |
| Logging | `page.tsx` has 0 `console.*` (G-3). New files use `clientLogger.child`; no URL, price or email in a log line. Nothing to convert |
| CI time | Four jsdom or pure suites inside the existing Jest job. No new job, script or `package.json` change. Nothing is added to the Build critical path |
| "zod is already in client bundles" (O-6) | **Not true.** No `'use client'` file in `app/`, `components/` or `hooks/` imports `zod` today. See RC-1 |

### Rulings on O-1..O-10

| # | Ruling |
|---|---|
| O-1 | **Approved:** a section on `/admin/system-config`, above today's table. The above-or-below choice goes to the user as B-1 |
| O-2 | **Approved: one-line `jest.mock` per page suite, with a change.** The mock renders a marker (`<div data-testid="price-comparison-section" />`), not `null`, so one case can prove the section is mounted and placed above today's table (RC-5). No existing assertion changes |
| O-3 | **Approved for slice 4, UI only.** R-9 row 4 puts "retired rows hidden or labelled" in this slice, and hiding Edit only removes a control. It changes no route, handler or request. It also protects data: a PUT on a retired row rewrites a row that slice 9's history reads (RR-6). **Server-side refusal is not in scope.** `PUT /api/admin/system-config/pricing` still accepts a retired id. Slice 6 removes direct edits, so that gap closes there; record it in the R-9 row 6 notes (RC-4) |
| O-4 | **Approved: one source, in `lineFlags.ts`.** `FLAG_LABELS` becomes a full `Record<PendingLineFlag, string>` (drop `Partial`, so `tsc` forces a label for any future flag). The manual-entry success response returns flag **codes**, so the form maps them through the same `FLAG_LABELS` and derives "needs a reason to apply" from `BLOCKING_FLAGS`. `priceReviewCopy.ts` holds no flag words (RC-3) |
| O-5 | **Safe; no shared types file required.** There is precedent on main with Build green: `components/public/PublicBrandProvider.tsx` and `PortalMeetings.tsx` (`'use client'`) do `import type { PublicBrand } from '@/lib/branding/publicBranding'`, a `server-only` module. SWC and ts-jest (`isolatedModules: true`) erase a statement-level `import type` before the module graph is built. Jest also maps `server-only` to a mock. **Condition (RC-2):** use the statement form `import type { … }` only, never inline `import { type X }`, and pin it in the source test |
| O-6 | **Approved: reuse `PendingLineSchema` in the browser.** Its import chain (`zod`, `bounds.ts`, `officialSources.ts`) is pure, and `isOfficialSourceUrl` uses `URL`, which browsers have. This is the **first client-side `zod`** in the repo, so it is a new pattern (rule 7), approved narrowly: one admin-only route chunk, the server stays the authority, no customer bundle is affected. Correct the analysis row (RC-1) |
| O-7 | **Approved:** not shown until slice 5. R-9 row 4 lists "per-provider status", so move that deliverable to row 5 in the requirement (RC-6) |
| O-8 | **Approved:** it pre-fills the form only. For an image row with provider `null`, leave Provider unselected and required |
| O-9 | **Approved:** compute it client-side from `units[].gapBasisPoints`. These are server numbers, so it involves no price arithmetic. A `null` gap goes last |
| O-10 | **Approved:** do not join the migrated-pages registry. Chips come only from `StatusChip`; do not hand-roll a green class (the layout standard has one green, in `StatusChip.tsx`) |

### Required changes (conditions of approval)

1. **RC-1 (O-6), Medium.** In section 1, replace "zod is already in client bundles" with a true statement: "first client-side `zod`; admin-only chunk; SA-approved narrowly for this form." From `@/lib/ai/pricing-research/`, the client files may import **values** only from `pendingLineSchema`, `officialSources`, `lineFlags` and `bounds`. `priceReview.source.test.ts` pins this.
2. **RC-2 (O-5), Medium.** Any import from `comparisonModel` or `areaTags` in the new files is a statement-level `import type`. The source test asserts that every such import line starts with `import type`.
3. **RC-3 (O-4), Medium.**
   - Before code, add a table to the workplan with the ten labels in business words. The blocking three say "needs a reason to apply".
   - Tests:
     - `lineFlags.test.ts`: every flag in `PENDING_LINE_FLAGS` has a non-empty label.
     - `comparisonModel.test.ts`: line 203 stays unchanged; add one case where a line with two flags returns both labels.
   - The slice 3 route suites and `chargingUntouched.guard.test.ts` stay green and unedited.
   - The workplan states that this changes the comparison read's output (more `flagLabels` entries). It changes no charge.
4. **RC-4 (O-3), Low.**
   - Retired label: `StatusChip tone="neutral"`, "Retired " + `formatUtcDate(retired_date)`.
   - Edit hidden by a condition around the existing button. The literal `handleEditPricing(model)` stays exactly once, so `source.guard.test.ts` is unchanged.
   - T-9 adds to the R-9 row 6 notes: "until slice 6, the PUT route still accepts a retired row id; the UI no longer offers it."
5. **RC-5 (O-2), Low.** The mock renders the marker div. One new page-suite case asserts that the marker comes before today's pricing table in document order (`compareDocumentPosition`).
6. **RC-6 (O-7), Low.** T-9 moves "per-provider status" from R-9 row 4 to row 5 and adds a Change History row.
7. **RC-7 Accessibility (MP-NFR-8), Medium.**
   - Collapse toggle: a `<button>` with `aria-expanded` and `aria-controls`.
   - Sort `<select>`: labelled with `<label htmlFor>`.
   - Form:
     - Every field has a `<label>`.
     - Kind radios sit in a `<fieldset>` with a `<legend>`.
     - A failing field gets `aria-invalid` and `aria-describedby` pointing at its message.
     - The refusal summary uses `role="alert"`; the success line uses `role="status"`.
   - Visible focus on every control: no `outline-none` without a focus ring.
   - Per-unit lines as a `<ul>`.
   - Tests:
     - C-11 asserts `aria-expanded`.
     - C-2 asserts the chip's `textContent` holds the words.
     - M-1 asserts `aria-invalid` on the failing field.
8. **RC-8 Source test, Low.** "No `Number(`/`parseFloat` on a price" cannot be tested as written. Instead, ban `Number(`, `parseFloat(`, `parseInt(` and `toFixed(` outright in the new files. The sort reads `gapBasisPoints`, which is already a number, so nothing needs them. Keep `console.` banned and `clientLogger` required.
9. **RC-9 Source link, Low.**
   - Render the `href` only when `isOfficialSourceUrl(provider, url)` passes.
   - For a row with provider `null`, require the `HTTPS_PREFIX` check instead.
   - This is defence in depth: the server already enforced the host at insert.
   - C-8 adds an off-list host that renders no link.

### Optimisation suggestions (non-blocking)

- "Checked on" default: build the local calendar date from `getFullYear`, `getMonth` and `getDate`, not `toISOString().slice(0, 10)`. Otherwise an admin west of UTC in the evening gets tomorrow's UTC date. The schema still accepts it, but the recorded date is wrong.
- Sort ties: treat provider `null` as `''`, so the order is total and stable.
- No-pending notice: name the actual button ("Enter a price by hand") rather than "the form below", because the form is closed by default.
- Keep `priceReview.source.test.ts` short: the RC-1, RC-2 and RC-8 bans plus the two-URL rule. The render suites carry the behaviour.

### Business questions

B-1 and B-2 go to the user through TL. SA has no objection to B-2: a pending line changes no charge, a later entry for the same unit supersedes it, and slice 8 brings dismiss.

### Approval

[x] Workplan approved. Proceed to implementation with RC-1..RC-9 folded in. Answers to B-1 and B-2 are needed before U-1 and U-6, not before coding.

### SA re-check (one table, 2026-10-14)

**Status:** ✅ The revision is approved with conditions NR-1..NR-5. Dev may start coding. Section 7's carry-over of RC-1..RC-9 is correct, and O-1, O-2, RC-5 and B-1 are superseded by UF-5.

**Rulings**

| # | Ruling |
|---|---|
| N-1 | **Approved.** `currentRowId: string \| null` on `ComparisonRow` is additive. `tokenCurrent` already computes `rowId`, and slice 3 already stores it as `current_row_id`. It is null unless the basis is `table`, and always null for image rows. Charging is unaffected, because the field lives only in the read model. A comparison row whose `currentRowId` has no match in the pricing list (the two reads raced) renders as comparison-only, with no Edit. `priceTableRows.test.ts` covers that case |
| N-2 | **Approved.** Export `unitGapText(unit: UnitComparison)`. It derives the sign from `status`: `undercharging` gives -1, `covered` gives +1, and `no_change` gives "0.00%". A null gap returns the server `label`. `gapText` and `formatGapPercent` keep their behaviour and the existing tests stay unedited. `coverageColour` joins the RC-1 value-import allow-list: it is pure and imports only `decimal.ts` |
| N-3 | **Approved; RC-3 is corrected.** Line 202 of `comparisonModel.test.ts` flags the line `['new_model', 'cached_input_listed']`, so a complete label record must return two labels. My "line 203 unchanged" was wrong. Change it to both labels, in flag order. The case's name and intent ("not used yet" beside the code) stay |
| N-4 | **Approved.** Read both lists with one `Promise.all`. If either is rejected or not ok, clear the rows and any open editor, show the existing banner and failure line, and log which read failed by name only. This follows C2-4 |
| N-5 | **Approved, with NR-2.** After a successful PUT, the row first takes the PUT reply as today, and then the comparison is read once. W2-1's "no extra read" is superseded by UF-5. The PUT request itself is unchanged |

**Required changes**

1. **NR-1 (Medium): "Stored, not in effect" covers two different cases.**
   - A non-retired row that is not joined is either **future-dated** (`effective_date` after the server's date) or **superseded**: an older active row that "newest wins" never charges.
   - Future-dated rows: label "Starts <date>", Edit kept, because the row will be charged.
   - Superseded rows: label "Superseded by a newer row, not charged", Edit hidden, for the same reason as RC-4 (editing it changes nothing charged).
   - Take "today" from `generatedAt.slice(0, 10)` in the comparison reply, the server's UTC date. Never use the browser clock.
   - `priceTableRows.test.ts` covers both cases.
2. **NR-2 (Medium): a failed re-read after a successful save.**
   - The save succeeded, so its success message stays. The table follows N-4: rows cleared, banner shown.
   - Add one render case, the save twin of R-10.
   - While the re-read runs, the table wrapper carries `aria-busy`.
3. **NR-3 (Medium): rules for the edits to existing tests (6.2).**
   - These edits are approved. My earlier "no existing assertion changes" assumed a separate, mocked section, and no longer applies.
   - Each edited case keeps its original intent, stated in a one-line comment:
     - R-1: only the pricing routes are read (now the set of two).
     - R-5: Sync re-reads once per list.
     - R-9: the saved value shows, and the PUT body is unchanged and still per-token.
     - R-10 and E-3: a failed read clears the table and closes the editor.
     - R-11: exact display, never rounded.
     - E-2: both saves show.
   - R-2, R-3 and R-4 keep their assertions verbatim.
   - No assertion on a PUT or Sync request body is weakened.
   - R-9's name drops "with no extra read" and cites N-5.
4. **NR-4 (Low): the per-token editor in a per-1M table.**
   - While editing, the two inputs carry the visible unit "per token", so an admin cannot type a per-1M figure into a per-token field.
   - The editor and its handlers are otherwise untouched until slice 6.
5. **NR-5 (Low): table structure.**
   - Image rows merge the six price cells into one `colSpan={6}` cell holding the `<ul>`.
   - The cached sub-line reads "cached: ours · provider · gap", with the basis in words ("derived: half of input") when it is not stored.
   - The two-row thead uses `scope="colgroup"` and `scope="col"`.
   - The render test checks one image row and one OpenAI row with the sub-line (T-9 already lists both).

**Re-verified**

- **`source.guard.test.ts`:**
  - It needs no change. The pricing route literal stays twice (the GET in `fetchData` and the PUT). The new `/api/admin/model-pricing/…` strings live in `priceComparisonRead.ts` and the form, which G-1 does not scan.
  - The Sync handler (S-9) and button (S-10) stay byte-identical. The handler only calls `fetchData(true)`, which now reads both lists, so no character of the pinned block changes.
  - The reworded Input and Output paragraphs must not contain "immediately", "per 1,000" or "boost" (MT-1, G-2). S-1, S-4 and MT-2 stay as quoted.
- **Charging:** no change. `lineFlags.ts`, `coverageColour.ts` and `comparisonModel.ts` are read-model files under `chargingUntouched.guard.test.ts`, which stays green and unedited.
- **Logging:** no `console.*` in the plan, and the client logger is used.
- **CI time:** unchanged, since everything runs inside the existing Jest job.

### SA Code Review

**Code Review by SA — 2026-10-14** (worktree `neuronforge-model-pricing-s3`, uncommitted, base `392a9b53`)
**Status:** ✅ Code Approved with conditions. F-1 and F-2 (Medium) must land before QA runs; F-3..F-5 (Low) in the same pass. No SA re-review needed: QA verifies them.

**What was verified**

| Check | Result |
|---|---|
| Suites | `npx jest app/admin/system-config lib/ai/pricing-research app/api/admin/model-pricing --ci`: 16 suites, 245 tests, all pass. `eslint app/admin/system-config`: 0 errors, the two pre-existing `no-unescaped-entities` warnings only. `tsc --noEmit`: nothing in the touched areas |
| Guards unedited | `git diff origin/main` is empty for `source.guard.test.ts` and `chargingUntouched.guard.test.ts`; both green. `handleSyncPricing` and the Sync button are not in the diff (only the toggle beside it gains aria) |
| Charging untouched | `git diff --stat origin/main` over `lib/ai/pricing.ts`, `chargePricing.ts`, `lib/ai/providers`, `lib/services`, `lib/repositories`, `app/api`: empty |
| RC-1 / RC-2 | Client value imports from `pricing-research` are only `coverageColour`, `lineFlags`, `pendingLineSchema`, `officialSources`. `comparisonModel` is reached only by statement-level `import type` (page, `priceComparisonRead`, `priceTableRows`, `PriceRowCells`, fixture). Pinned by `priceReview.source.test.ts` |
| RC-7 | Toggle `aria-expanded` / `aria-controls` / `aria-label`; labelled Sort; `<caption>`; two-row thead with `colgroup` / `col` scopes; form labels, `<fieldset>`/`<legend>`, `aria-invalid` + `aria-describedby`, server refusal `role="alert"`, success `role="status"`; focus rings on every new control; image units and flags as `<ul>`. Gap: client-side refusals (F-2) |
| RC-8 | No `Number(`, `parseFloat(`, `parseInt(`, `toFixed(` in the five new files (pinned). The fixture does test-only arithmetic, which is fine |
| RC-9 | `href` only when `isOfficialSourceUrl(provider, url)`; `HTTPS_PREFIX` when provider is null; `rel="noopener noreferrer"`. T-10 covers an off-list host |
| NR-1 | Unjoined non-retired rows split by `effective_date > generatedAt.slice(0,10)`. `effective_date` is a `date` column and `listActive` uses `.lte('effective_date', <UTC today>)`, so the server UTC date is the right "today". Starts-later keeps Edit; superseded and retired do not |
| NR-2 | Save: PUT reply into the row, then `rereadComparison()`; failure keeps the success message and calls `markPricingReadFailed` (R-13). `aria-busy` set during re-read (not asserted, F-4) |
| NR-3 | R-2/R-3/R-4 not in the diff. Each edited case carries an intent comment. R-9 still asserts the exact per-token PUT body and is renamed per N-5. No PUT or Sync body assertion weakened |
| NR-4 / NR-5 | "per token" labels on both editor inputs (T-11b); `colSpan={6}` image cell with `<ul>`; cached sub-line "cached: … (derived: half of input)"; header scopes (T-1b) |
| N-1 join and race | `currentRowId` is null unless basis `table`, always null for images; read-model only. An unmatched id renders comparison-only with no Edit; the orphaned stored row then shows as superseded or starts-later. Harmless and covered by `priceTableRows.test.ts` |
| Info box | Reworded Input/Output paragraphs contain no "immediately", "per 1,000" or "boost"; S-1, S-4, MT-2 unchanged |
| Logging / data access | No `console.*` in any touched file; `clientLogger.child` in the two files that log; no URL, price or email in a log line. No Supabase import on the client; both new reads go through existing admin routes |
| Read-model libs | `FLAG_LABELS` (full record), `unitGapText` (additive export, existing functions unchanged), `currentRowId` (additive field): display only, no charge reads them |

### Code Review Comments

1. **F-1 — `page.tsx` Model cell (D-4): the effective date of the charged row is no longer shown anywhere.** Priority: Medium. For an active, joined row the admin used to see when its price took effect; now only starts-later rows show a date. That is the one piece of D-4 an admin still needs until slice 9 (history): it is how they tell whether Sync or a dated insert last moved the price. **Fix:** in the Model cell, when `row.kind === 'compared' && row.stored`, add a muted line `In effect since ${formatUtcDate(row.stored.effective_date)}` (string in `priceReviewCopy.ts`, no `Date` parsing). One assertion in T-1 or R-12. The per-token figure itself is not needed: it shows in the editor when Edit is opened, and the per-1M "ours" is the same stored price.
2. **F-2 — `ManualPriceEntryForm.tsx:136-145`: a client-side refusal is silent to a screen reader, and one on an unrendered field blocks silently.** Priority: Medium (RC-7). Client refusals only set `fieldErrors`; no `role="alert"` summary is rendered, so nothing is announced. An issue whose `path[0]` is a field the form does not render (e.g. `kind`, or an image field while `kind` is token) is stored, renders nowhere, and the Save does nothing. **Fix:** on a client refusal also `setRefusal({ message: <new copy, e.g. 'Check the fields marked below.'>, problems })`, where `problems` is `"<FIELD_WORDS[field] ?? FORM_WORDS.refusedLine>: <message>"` per issue, so every issue is listed in the `role="alert"` box. Extend M-1 to assert the alert.
3. **F-3 — `priceTableRows.ts:117-124`: "Most undercharged first" puts a red "Not priced" row at the bottom with the grey rows**, because its `worstGapBasisPoints` is null. Priority: Low. **Fix:** order `redFirst || byGap(…, 1) || byName`. Red rows (including not priced) come first, ordered by gap, null last; this also covers D-2's sub-1 bp tie without a special case. The existing `priceTableRows` expectations hold; add one case with a red null-gap row.
4. **F-4 — NR-2 `aria-busy` is set but not asserted.** Priority: Low. **Fix:** in R-9 or R-13, hold the second comparison reply on a deferred promise, assert `getByTestId('pricing-table-wrap')` has `aria-busy="true"`, then resolve it and assert the attribute is gone.
5. **F-5 — `ManualPriceEntryForm.tsx:85`: dead `provider: ''` entry in `values`.** Priority: Low. Provider lives in its own state; remove the key (keep `'provider'` in `Field` for the error map).

### Optimisation Suggestions

- `fetchData` has no last-response-wins guard: two overlapping reads (refresh plus a manual-entry `onSaved`) can resolve out of order. Pre-existing pattern, rare on an admin page; consider a request counter in slice 6 when the editor goes.
- `aria-controls="model-pricing-body"` names an element that is absent while collapsed. Acceptable; rendering the body with `hidden` instead would make the reference always valid. L-11 can take it.
- The pinned S-1 subtitle still says "Cost per token for each AI model" over a per-1M table. It cannot change without a guard edit; record it for slice 6, which edits that guard anyway.

### Rulings on D-1..D-6

| # | Ruling |
|---|---|
| D-1 | **Approved.** The success line and flag words stay readable while the table re-reads; provider and model stay filled for a second unit; Close is one click. No state leaks: a new open remounts by `key` |
| D-2 | **Approved**; F-3 replaces the special-case tie-break with red-first ordering, which keeps the same intent |
| D-3 | **Approved.** `__fixtures__` starts with `_`, so the App Router treats it as a private folder (no route), Jest does not collect it, and nothing in the page imports it |
| D-4 | **Approved with F-1.** Dropping the per-token display loses nothing needed (the editor still shows per token; per-1M "ours" is the same stored value, printed exactly). The effective date of the charged row must come back as a muted line (F-1). The provider column folded under the model is fine |
| D-5 | **Approved.** The shared `ADMIN_TABLE*` classes on a table rebuilt anyway; L-11 still owns the page chrome |
| D-6 | **Approved.** `fireEvent.change` fires the same change event; the cases assert the posted strings, so nothing is lost, and CI time stays flat |

### Code Approved for QA: Yes, after F-1 and F-2 (F-3..F-5 in the same pass)

## QA Testing Report

**QA — 2026-10-14**
**Test mode:** full (UI only)
**Strategy used:** A (Jest unit and jsdom render suites, re-run), mutation checks on scratch copies (moduleNameMapper swap, worktree untouched), static source checks, D (manual browser checklist reviewed and tightened for the user; QA cannot sign in to production)
**Focus:** ui, schema, security (link host, Edit gating), charging untouched
**Skipped:** live browser run (no dev server per instruction; user runs U-1..U-12 after deploy); `lint` and `tsc` not re-run (not in this QA brief; Dev reports them green)
**Input source:** prompt (TL brief)

### Step 1: suites re-run (counts verbatim)

| Command | Result |
|---|---|
| `npx jest app/admin/system-config lib/ai/pricing-research app/api/admin/model-pricing --ci` | Test Suites: 16 passed, 16 total · Tests: 245 passed, 245 total |
| `npm run test:bos-entitlements` | Test Suites: 264 passed, 264 total · Tests: 7869 passed, 7869 total |
| `npm run test:authz-guard` | Test Suites: 2 passed, 2 total · Tests: 203 passed, 203 total |
| `npx jest app/__tests__/tailwind-css-escape.guard.test.ts --ci` | Test Suites: 1 passed, 1 total · Tests: 6 passed, 6 total |

`source.guard.test.ts` and `chargingUntouched.guard.test.ts` are unedited and green.

### Step 2: mutation checks

Mutants were written to the QA scratchpad and swapped in through a scratch Jest config (or, for the file-reading guards, a scratch mirror used as cwd). Three identity mutants passed first (21/21, 21/21, 20/20), proving the swap harness.

| # | Mutation | Caught? | By |
|---|---|---|---|
| 1 | Status chip loses its words (all four) | ✅ Killed (5 failed) | T-2, T-3, T-4, T-5, T-6 |
| 1b | Red chip only loses "Undercharging" | ✅ Killed (2) | T-2, T-6 |
| 1c | Green chip only loses "Covered" | ✅ Killed (1) | T-3 |
| 2 | Price via `Number(v).toFixed(2)` ($0.075 → $0.08) | ✅ Killed (6) | R-9, R-11, E-2, T-1, T-4, T-9; also the RC-8 source ban |
| 2b | Price via `String(Number(v))` | ✅ Killed by `priceReview.source` (RC-8 ban) only; render suites pass (harmless for the fixture strings) | RC-8 |
| 3 | Superseded row keeps Edit | ✅ Killed (1) | T-11 |
| 4 | Retired row keeps Edit | ✅ Killed (2) | R-12, T-11 |
| 5 | Join by model name instead of `currentRowId` | ✅ Killed (1) | `priceTableRows` NR-1 case |
| 5b | `currentRowId`, falling back to provider + model name | ✅ Killed (2) | E-1, T-12 |
| 6 | "Today" from the browser clock | ✅ Killed today, but see Bug 2: the kill expires on 2026-10-20 | `priceTableRows` "takes today from generatedAt" |
| 7 | Save sends per-1M (`× 1,000,000`) | ✅ Killed (1) | R-9 (exact PUT body) |
| 8a | Source link for any host | ✅ Killed (1) | T-10 |
| 8b | Source link for any https URL (provider check dropped) | ✅ Killed (1) | T-10 |
| 9a | 400/422 `problems[]` not shown | ✅ Killed (2) | M-4 (400 and 422) |
| 9b | No server words at all (fallback text, no field marks) | ✅ Killed (5) | M-4, M-4b, M-5 (409, 403) |
| 10 | Sync button text changed | ✅ Killed (1) | `source.guard` S-10 |

### Step 3: static checks on the new files

| Check | Result |
|---|---|
| `console.*` (5 new files, fixture, `page.tsx`, 3 lib files) | 0 everywhere ✅ |
| `Number(` / `parseFloat(` / `parseInt(` / `toFixed(` in the 5 new files + fixture | 0 ✅ (the old per-token editor in `page.tsx` keeps its own, as RC-8 allows) |
| `comparisonModel` / `areaTags` imports | 5 lines (`priceComparisonRead`, `priceTableRows`, `PriceRowCells`, fixture, `page.tsx`), all statement-level `import type {` ✅; no `areaTags` import |
| Backslash + hex character in any changed or new `.ts` / `.tsx` / `.md` | none ✅ |
| RC-7 aria | Toggle `aria-expanded` + `aria-controls="model-pricing-body"` (target id exists) + `aria-label` ✅; Sort `<label htmlFor="price-sort">` ✅; every form field has a `<label htmlFor>` ✅; Kind radios in `<fieldset>` + `<legend>` ✅; `aria-invalid` + `aria-describedby` → error id on failing fields (incl. Provider select) ✅; refusal `role="alert"`, success `role="status"` ✅; `focus-visible:ring-2` wherever `outline-none` appears ✅; image units and flags as `<ul>` ✅; thead `scope="colgroup"` / `scope="col"` ✅; table wrapper `aria-busy` during the re-read ✅ |

### Step 4: charging untouched

`git diff origin/main --name-only` (origin/main = `7a1ffe78`) and `git diff 392a9b53 --name-only` over `lib/ai/pricing.ts`, `lib/business-os/llm/chargePricing.ts`, `lib/repositories/SystemConfigRepository.ts`, `lib/services/EmbeddingService.ts`, `lib/business-os/llm/modelSettings.ts`: **0 files** each ✅. The wider set in section 5 (`lib/ai/providers`, `lib/services`, `lib/repositories`, `app/api`) is also empty.

### Test Coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| UF-5 one table: ours, provider, gap per unit | ✅ | Pass | T-1; exactly one `<table>` |
| Chip always carries words (MP-NFR-8) | ✅ | Pass | Mutations 1, 1b, 1c killed |
| Exact server strings, never rounded | ✅ | Pass | R-11, T-4; mutation 2 killed |
| Gap text, sub-1 bp red never "0.00%" (N-2) | ✅ | Pass | T-2 |
| Areas, "(off)", "not used by Business OS" | ✅ | Pass | T-7 |
| Flags in words, blocking "needs a reason to apply" (RC-3) | ✅ | Pass | T-8, `lineFlags.test.ts` |
| Source link only for an official host (RC-9) | ✅ | Pass | T-10; mutations 8a, 8b killed |
| Retired / starts later / superseded rows, Edit gating (RC-4, NR-1) | ✅ | Pass | R-12, T-11; mutations 3, 4 killed |
| Today from server `generatedAt` (NR-1) | ✅ | Pass | Re-pass: fixed; mutations 6, 6b, 6c killed at any clock |
| Join by `currentRowId` (N-1) | ✅ | Pass | Mutation 5 killed. Re-pass: 5b survives, a test gap (Edge case 3) |
| Either read failing fails the table (N-4) | ✅ | Pass | T-13 (500, success false, reject), R-2..R-4 |
| Save re-reads comparison; failed re-read keeps success, clears table (N-5, NR-2) | ✅ | Pass | R-9, R-13, T-15 |
| PUT body still per token | ✅ | Pass | R-9; mutation 7 killed |
| Manual entry: client refusal, 400/422 problems, 409/403/network, success words (UF-6) | ✅ | Pass | M-1..M-7; mutations 9a, 9b killed |
| Sync handler and button unchanged | ✅ | Pass | S-9, S-10; mutation 10 killed |
| No Apply / Dismiss / Check / History; muted note | ✅ | Pass | T-14 |
| Sort modes, stored-only rows last | ✅ | Pass | T-12 (re-pass: about 0.4 s); F-3 red first, mutation F-3 killed |
| No charging change | ✅ | Pass | Step 4 |
| Browser journey in production | ⚠️ | Owed by user | U-1..U-12 below |

### Issues Found

#### Bugs (must fix before commit)

0. **SA code-review fixes F-1..F-5 are not in the code QA tested.** SA's code review (appended to this workplan while QA was running) says F-1 and F-2 must land before QA runs. At QA time (source files last modified 20:59; checked at 21:37) none has landed:
   - F-1: no "In effect since" line anywhere in `app/admin/system-config` (Medium).
   - F-2: `ManualPriceEntryForm.tsx` client refusals still set only `fieldErrors`, with no `role="alert"` summary (Medium).
   - F-3: `priceTableRows.ts` still orders `byGap` before `redFirst` (Low).
   - F-4: no `aria-busy` assertion in any suite (Low).
   - F-5: `provider: ''` is still in `values`, at `ManualPriceEntryForm.tsx:85` (Low).

   Every result in this report is for the pre-F-1 code. When the F pass lands, re-run step 1, plus mutations 1, 2, 3, 4, 6 and 9 (the files they touch are the ones F-1..F-3 change).
1. **T-12 runs over Jest's 5 s default timeout and failed once** — File: `app/admin/system-config/__tests__/priceTable.render.test.tsx` (T-12) — Severity: **Medium** (a flaky case in the required Jest gate)
   - Steps to reproduce: `npx jest app/admin/system-config/__tests__/priceTable.render.test.tsx --ci --verbose -t "T-12"`, three times.
   - Expected: well under 5 s, like the other cases (the next slowest is 1.2 s).
   - Actual: 7031 ms, 6826 ms and 6578 ms. It passes only because jsdom's synchronous work delays the timeout timer. Under load in the mutation run it failed with "Exceeded timeout of 5000 ms" (the run where the price-mutant 2b was otherwise a survivor).
   - Likely cause: `order()` calls `getAllByRole('row')` and `getAllByRole('cell')` four times on an 11-column table, plus two `userEvent.selectOptions`. Fix: read rows through `container.querySelectorAll('tbody tr')`, or use `fireEvent.change` on the select (as D-6 did for the form). Do not just raise the timeout; that adds CI time.
2. **The "today from the server, never the browser clock" guard expires on 2026-10-20** — File: `app/admin/system-config/__tests__/priceTableRows.test.ts` ("takes today from generatedAt"), with T-11 in `priceTable.render.test.tsx` — Severity: **Medium** (it pins SA NR-1 and will stop pinning it with no red signal)
   - Steps to reproduce: the browser-clock mutant (mutation 6) is killed today only because the real date (2026-10-14) is before the fixture's `effective_date` 2026-10-20. From 2026-10-20 the mutant gives the same answer as the code ("superseded"), so the test passes on wrong code. T-11's future row (2026-11-01, `SERVER_NOW` 2026-10-14) stops telling the two apart after 2026-11-01.
   - Expected: the case fails on a browser-clock implementation at any date.
   - Fix: pin the browser clock away from the server date in that case, for example `jest.useFakeTimers().setSystemTime(new Date('2020-01-01'))` with `generatedAt` in 2026, or use dates far in the future (2099) so the real clock can never reach them.

#### Performance Issues (should fix)

None in product code. T-12 above is a test-time cost.

#### Edge Cases (nice to fix)

1. Mutation 2b (`String(Number(v))`) is caught only by the RC-8 source ban, not by any render case. That is acceptable: the ban is the designed guard, and the render cases use strings that survive the conversion. A server string with trailing zeros (for example "0.150") would pin it at render level too.
2. The `role="alert"` and `role="status"` regions mount together with their text. Some screen readers announce a `role="status"` region only when its content changes after mount. Keeping an empty status region mounted would make this reliable. Low.

### QA re-pass after the F pass (2026-10-14)

**Scope:** SA F-1..F-5, QA Bugs 1 and 2, the always-mounted `role="status"`, and the `userEvent.click` to `fireEvent.click` conversion. Worktree `neuronforge-model-pricing-s3`, uncommitted, merged with origin/main `858f037d`. Same strategy as the first pass: A (Jest), mutation checks on scratch copies (worktree untouched), static checks, D (checklist for the user). Bugs 0, 1 and 2 of the first pass are verified fixed below.

#### R-1: suites re-run (counts verbatim) ✅

| Command | Result |
|---|---|
| `npx jest app/admin/system-config --ci --verbose`, run 1 | Test Suites: 7 passed, 7 total · Tests: 109 passed, 109 total · Time 22.161 s · slowest: T-1, 1287 ms |
| same, run 2 | Test Suites: 7 passed, 7 total · Tests: 109 passed, 109 total · Time 21.846 s · slowest: E-1 "a 500", 1167 ms |
| same, run 3 | Test Suites: 7 passed, 7 total · Tests: 109 passed, 109 total · Time 21.837 s · slowest: T-1, 1159 ms |
| `npx jest lib/ai/pricing-research app/api/admin/model-pricing --ci` | Test Suites: 9 passed, 9 total · Tests: 140 passed, 140 total |
| `npm run test:bos-entitlements` | Test Suites: 264 passed, 264 total · Tests: 7870 passed, 7870 total |
| `npm run test:authz-guard` | Test Suites: 2 passed, 2 total · Tests: 203 passed, 203 total |
| `npx jest app/__tests__/tailwind-css-escape.guard.test.ts --ci` | Test Suites: 1 passed, 1 total · Tests: 6 passed, 6 total |

**Speed (first-pass Bug 1): fixed.** T-12 ran in 393, 481 and 399 ms (it was 6.6 to 7.0 s). Every test is at or under 1.3 s, far inside Jest's 5 s default, with no timeout raised. The slowest case was 1159 to 1287 ms here, a little above the 1.05 s the Change History reports. The difference is machine load, and it is not a finding. T-15 (F-4) ran in 666 to 709 ms, and R-13 in 402 to 474 ms.

#### R-2: mutation checks ✅ (one test gap, see Edge case 3)

The harness reads the current files directly, and the identity mutants passed first: 22/22 for page, 22/22 for cells, 20/20 for the mirror, and 36/36 for `priceTableRows` under each shifted clock.

| # | Mutation | Caught? | By |
|---|---|---|---|
| 1 | Status chip loses its words (all four) | ✅ Killed (5 failed) | T-2, T-3, T-4, T-5, T-6 |
| 1b / 1c | Red only / green only loses its word | ✅ Killed (2) / (1) | T-2, T-6 / T-3 |
| 2 | Price via `Number(v).toFixed(2)` | ✅ Killed (6) | E-2, R-9, R-11, T-1, T-4, T-9 |
| 2b | Price via `String(Number(v))` | ✅ Killed by the RC-8 source ban (1); render suites pass, as before (Edge case 1) | `priceReview.source` |
| 3 | Superseded row keeps Edit | ✅ Killed (1) | T-11 |
| 4 | Retired row keeps Edit | ✅ Killed (2) | R-12, T-11 |
| 6 | "Today" from the browser clock, at the real date | ✅ Killed (3) | both "takes today from generatedAt" cases, T-11 |
| 6b | Same, with the ambient clock shifted to 2026-10-25 (after the date the first-pass guard expired) | ✅ Killed (4) | the same three, plus NR-1 |
| 6c | Same, with the ambient clock shifted to 2100-06-01 | ✅ Killed (4) | the same four |
| 9a | 400/422 `problems[]` not shown | ✅ Killed (2) | M-4 (400, 422) |
| 9b | No server words at all | ✅ Killed (5) | M-4 (two), M-4b, M-5 (409, 403) |
| F-1 | "In effect since" hidden | ✅ Killed (1) | T-1 |
| F-2a | Browser refusal sets no alert | ✅ Killed (5) | M-1 (four cases), M-1b |
| F-2b | Browser alert shown, but without its problem lines | ✅ Killed (5) | M-1 (four cases), M-1b |
| F-3 | No red-first in "Most undercharged first" (gap, then name) | ✅ Killed (3) | the sub-1 bp case, the F-3 not-priced case, T-12 |
| 5, 7, 8a, 8b, 10 | Re-run as a control | ✅ Killed (1 each) | NR-1, R-9, T-10, T-10, S-10 |
| 5b | Join by `currentRowId`, falling back to provider + model name | ⚠️ **Survived** (57/57) | none, see Edge case 3 |

**Mutation 6 (first-pass Bug 2): fixed.** The two `priceTableRows` cases pin the browser clock with fake timers on opposite sides of the server date (2020 and 2099), and T-11 pins it to 2099. A browser-clock implementation fails at any real date. 6b and 6c prove this by running the whole file under a shifted ambient clock; the unmutated code passes under the same clocks (36/36 each).

**Correction to the first pass, mutation 5b.** The first pass reported 5b as killed by E-1 and T-12. Those were the two slow cases, so the kill was almost certainly a timeout under load, not an assertion. Now that the cases run fast, 5b survives. See Edge case 3.

#### R-3: `fireEvent` conversion spot-check ✅

| File | Checked against | Result |
|---|---|---|
| `pages.edge.qa.test.tsx` | `git diff origin/main` | All 6 `userEvent.click` calls became `fireEvent.click`, each with the one-line comment. No `expect` was removed: 11 before, 12 after. E-2 gained a `$1.5` check between the saves. The only changed assertions are the per-1M price strings and the comparison GETs in the call lists, which SA approved under NR-3 |
| `pages.render.test.tsx` | `git diff origin/main` | All 10 clicks converted. 40 `expect` before, 44 after. No assertion was dropped by the conversion. R-11's per-token lines were removed earlier, under D-4 (approved by SA). R-9 still asserts the exact per-token PUT body |
| `priceTable.render.test.tsx`, `manualPriceEntry.render.test.tsx` | New files, so no git baseline | Each `fireEvent.click` / `fireEvent.change` is followed by its assertions (T-11b, T-12, T-15, the two row-button cases, and the shared `save()` helper behind M-1..M-7). No `userEvent` import is left anywhere in `app/admin/system-config` |

#### R-4: guards, charging and file content ✅

| Check | Result |
|---|---|
| `source.guard.test.ts` and `chargingUntouched.guard.test.ts` against origin/main | 0 diff lines; both green in R-1 |
| Charging files against origin/main (`lib/ai/pricing.ts`, `lib/business-os/llm/chargePricing.ts`, `modelSettings.ts`, `lib/repositories`, `lib/services`, `lib/ai/providers`, `app/api`) | 0 files in `git diff --name-only`, and 0 in `git status` (no untracked file either) |
| Backslash followed by a hex character, over all 21 changed and new files | none |
| F-4 / F-5 / status region (by reading) | T-15 asserts `aria-busy="true"` while the re-read is held, then its absence. `values` has no `provider` key. `role="status"` is always mounted, and `manualPriceEntry` asserts it empty while idle |

#### Re-pass issues

**Bugs:** none open. First-pass items 0 (F-1..F-5), 1 (T-12 speed) and 2 (the clock guard) are verified fixed.

**Edge case 3 (new, Low, test-only): no test pins "never fall back to the model name" in the join.** Mutation 5b survives. This is the code in `priceTableRows.ts` that joins a comparison row to its stored row: `currentRowId ? byId.get(...) : null`.
- The product code is correct.
- The gap: suppose a later change adds a fallback by provider + model name. The suite stays green.
- What that would break: a comparison row whose id is null or unmatched would pick up a stored row with the same name. That row can be superseded or starts later. It would then show that row's price as "ours" and offer Edit on a price that is not charged.
- Why no test catches it: the two cases in `priceTableRows.test.ts` with an unmatched or null id ("reads raced" and "comparison-only") both pass an empty stored list.
- **Fix:** one case. Give a comparison row an unmatched `currentRowId` (or null). Add a non-retired stored row with the same provider and model name and an older `effective_date`. Expect the compared row to have `stored: null`, and the stored row to be `superseded`.
- Recommended in the same pass; it does not block commit.

### Step 5: browser checklist (final, for the user after deploy)

Do the refusals first, then the one real entry, so production gets at most one pending line. **Do not press Save on a row's Edit in production: Edit still changes the live charged price.**

| # | Step | Expected |
|---|---|---|
| U-1 | Open `/admin/system-config` | One table with a two-row header ("Input /1M" and "Output /1M", each with ours · provider · gap). The muted note "Nothing in the provider column is charged yet…" sits above it. The Sync button and its paragraph are unchanged |
| U-2 | Look at the rows before entering anything | The notice "No provider prices entered yet…" shows, and every priced row reads "No new price" (grey chip with words). Area tags appear on models Business OS uses ("(off)" when switched off); others read "not used by Business OS". gpt-4o-mini shows a "cached:" sub-line ("derived: half of input" when not stored). A model with no price reads "Undercharging" with "not priced" in words. Prices print as the stored decimals, for example $0.15, never rounded. Under the model name, each active stored row shows a muted "In effect since YYYY-MM-DD" line (SA F-1). Retired, "Starts…" and "Superseded…" rows do not show it |
| U-3 | Change Sort through all three options | Order changes; retired, "Starts…" and "Superseded…" rows stay last in every mode |
| U-4 | Find the 12 rows retired on 2026-10-11 | Each reads "Retired 2026-10-11" with no Edit. Any "Superseded by a newer row, not charged" row has no Edit; any "Starts <date>" row and every active stored row has Edit |
| U-5 | Press Edit on any active row, look, then Cancel | The two inputs are labelled "Input, per token" and "Output, per token". **Cancel, do not Save** |
| U-6 | Open "Enter provider price". Enter a source URL `http://platform.openai.com/docs/pricing`, then `https://example.com/pricing` | Refused in the browser each time: the Official source URL field turns red with a message under it. A red box reads "Check the fields marked below." and lists "Official source URL: <message>" (SA F-2). There is no "Saved…" line, and the table is unchanged |
| U-7 | Enter openai, gpt-4o-mini, input 2000, output 0.6, the real source URL from U-8 | Refused by the server (422): the red box shows the route's message and the problem with its field name; values stay in the form; nothing is saved |
| U-8 | B-2 real entry (UF-6), from the row's "Enter provider price" button: provider **openai**, model **gpt-4o-mini**, kind token, input **0.15**, output **0.60**, cached input **0.075** (USD per 1M tokens, standard tier), source **https://developers.openai.com/api/docs/pricing**, checked on today | "Saved as a pending price. No charge changes until it is applied." and the flag "provider lists a cached-input price". No "replaced an earlier pending price" line on the first entry. After the re-read, the gpt-4o-mini row shows provider $0.15 / $0.6, gap 0.00%, chip "Covered" in words. The Source cell shows "Provider page", "Checked <today>", "Entered by <your email>". The link opens OpenAI's pricing page in a new tab |
| U-9 | Look for Apply, Dismiss, Check provider prices or History | None present |
| U-10 | Keyboard only: Tab through the collapse toggle, Sort, "Enter provider price" and the form fields | Every control shows a visible focus ring; the toggle collapses and expands the price card |
| U-11 | Press the page's Refresh | Rows stay on screen during the refresh, and the pending gpt-4o-mini price is still there |
| U-12 | Optional: DevTools, Network, then reload | Two GETs: `/api/admin/system-config/pricing` and `/api/admin/model-pricing/comparison`; no PUT or POST |

**About U-8's figures.** The TL checked them on 2026-10-14 at `https://developers.openai.com/api/docs/pricing`. For gpt-4o-mini, standard tier, USD per 1M tokens: input 0.15, cached input 0.075, output 0.60. They match our stored price, so the expected chip is green "Covered" with a 0.00% gap. That host is on the official list for openai, along with `platform.openai.com` and `openai.com`, so the Source cell shows it as a link. If the page shows different figures on the day, enter what it says. The chip then turns red ("Undercharging") or stays green with a positive gap, and either result is a valid test.

### Final Status

*Re-pass 2026-10-14. This replaces the first-pass status, which listed F-1..F-5 and Bugs 1 and 2; all of them are now verified fixed.*

- [x] All acceptance criteria pass — ready for commit
- [ ] Issues found — Dev must address before commit

No bug is open, at any severity. One Low test gap is recommended for the same pass, but it does not block commit. It is Edge case 3: a join case that kills mutation 5b. Edge case 1 (the render-level trailing-zero case) is still optional. The browser record U-1..U-12 is owed by the user after deploy.

**CLAUDE.md minimum:** met for the automated part. The UI flow has its happy path (T-1, M-6) and failure paths (T-13, R-13, M-4/M-5) tested, and source-level Jest guards back it. No new route or repository, so no route or repository minimum applies. The manual browser record (U-1..U-12) is owed by the user after deploy.

## Commit Info

_To be completed by RM._

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-14 | Created | Dev workplan for R-9 row 4: comparison section on `/admin/system-config` above today's table, built on the shared admin layout parts; per-unit current vs pending with server-computed colour, gap and words; area tags, flags in words, source and checked date; sort by gap; manual-entry form on the existing route with 400 / 422 messages shown; retired rows labelled in today's table; no apply, fetch or history; open questions O-1 to O-10, business questions B-1, B-2. No code written |
| 2026-10-14 | Revised for one table | User decision UF-5: the existing Model pricing table becomes the comparison (no separate section); B-1 superseded, B-2 answered yes (UF-6). Two reads joined by row id (N-1): the comparison drives every displayed price, gap, status, area and flag; the pricing list supplies Edit ids, dates and retired rows. Cached input as a sub-line, image units listed in the row. SA RC-1..RC-9 adapted (section 7; RC-5 replaced by T-1); ten flag labels (RC-3); `source.guard.test.ts` unchanged; existing render-suite edits listed for SA (6.2); new questions N-1..N-5. No code written |
| 2026-10-14 | SA re-check folded in; implementation started | NR-1 (future-dated rows "Starts <date>" keep Edit; superseded rows "Superseded by a newer row, not charged" without Edit; today from the server `generatedAt`), NR-2 (failed re-read after a save keeps the success message, clears the table; `aria-busy` during the re-read; new case R-13), NR-3 (edited cases keep their intent in a comment; R-2..R-4 verbatim; R-9 renamed), NR-4 ("per token" on the editor inputs), NR-5 (`colSpan={6}` image cell, cached sub-line wording, header scopes). N-1..N-5 approved; N-3 corrects RC-3 (line 203 changes) |
| 2026-10-14 | Code complete, uncommitted | T-0..T-8 done. One table on `/admin/system-config` from two reads joined by `currentRowId`; cached sub-line, merged image cell, status chips with words, flags in words, RC-9 links, sort by gap, retired / starts-later / superseded rows, "per token" editor labels, save re-read with `aria-busy` and the NR-2 failure path; manual-entry form. Lib: full `FLAG_LABELS`, `unitGapText`, `currentRowId`. Suites: 16 / 245 pass across `app/admin/system-config`, `lib/ai/pricing-research`, `app/api/admin/model-pricing`; `source.guard.test.ts` and `chargingUntouched.guard.test.ts` unedited and green. Deviations D-1..D-6 in 10.1 |
| 2026-10-14 | SA code review | Approved with conditions: F-1 (show "In effect since" for joined rows, D-4) and F-2 (client refusals announced in the `role="alert"` box) before QA; F-3..F-5 Low in the same pass. D-1..D-6 approved (D-4 with F-1, D-2 superseded by F-3) |
| 2026-10-14 | SA F-1..F-5 and QA bugs fixed; merged origin/main | F-1 "In effect since <date>" under the model of a charged stored row (T-1). F-2 browser refusals also listed in the `role="alert"` box ("Check the fields marked below.", one line per issue; M-1, M-1b); the `role="status"` region is always mounted, empty when idle (QA edge case 2). F-3 "Most undercharged first" orders red rows first, then gap, then name (new case with a red not-priced row; T-12 now expects it third). F-4 `aria-busy="true"` on `pricing-table-wrap` during the save re-read, gone after (T-15). F-5 `provider` dropped from the form text values. QA Bug 1: T-12 reads rows with `querySelectorAll` and sorts with `fireEvent.change` (498 ms in the full run). QA Bug 2: the clock cases pin the browser clock with fake timers on both sides of the server date (`priceTableRows`), and T-11 pins it to 2099 (Date only), so a browser-clock version fails at any real date. `git merge origin/main` fast-forwarded to `858f037d`; the requirement edits were re-applied on top of main's Q10 and gpt-image-1 rows. Suites: system-config 7 / 109, pricing-research + model-pricing 9 / 140. Uncommitted |
| 2026-10-14 | Test speed: root cause found and fixed | **Root cause:** the cost was not a wait; nothing waited out a timeout and no fetch was left unresolved (a step-by-step probe showed every `findBy` settling in 25 to 120 ms). It was `userEvent.click`: each click took 250 to 400 ms in jsdom on this page, because it checks `pointer-events` through the computed style of every ancestor and fires the full pointer and mouse sequence, and each event re-renders the whole table. With up to six clicks per case, then multiplied about threefold by seven parallel Jest workers on an 8-core machine already at 100% CPU, E-1 reached 3.5 to 5.3 s. Run alone or in band, the same cases took 0.7 to 1.3 s. **Fix:** `userEvent.click` became `fireEvent.click` in `pages.edge.qa`, `pages.render`, `priceTable.render` and `manualPriceEntry.render`. Each edited case in the existing suites carries a one-line comment; intent and every assertion are unchanged, and no timeout was raised. **Result:** three full `app/admin/system-config` runs, 7 / 109 each. The slowest test was 1012, 1048 and 1046 ms; every E case was under 1.05 s (E-1 "a 500" went from 4031 to 945 ms). `source.guard.test.ts` and `chargingUntouched.guard.test.ts` are unedited |
| 2026-10-14 | QA re-pass gap closed (mutation 5b) | QA's re-pass after the F-1..F-5 pass and the test-speed fix found one surviving mutant: a fallback join on provider and model name when `currentRowId` is null or unmatched (57/57 passed with it). New `priceTableRows.test.ts` case, run for both a null and an unmatched id: an older, same-provider, same-model, non-retired stored row is never joined by name, so the compared row has `stored: null` (no Edit) and the stored row comes out `superseded`. The mutant was applied to a copy and killed (2 failed), then the file was restored. `app/admin/system-config`: 7 suites / 111 tests pass. Uncommitted |
