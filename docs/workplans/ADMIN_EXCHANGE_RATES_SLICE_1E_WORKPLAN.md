# Workplan: Admin Exchange Rates — Slice 1e (Rate sync, suggestions, accept, D-10 additions)

> **Last Updated**: 2026-10-25

**Developer:** Dev
**Requirement:** [ADMIN_EXCHANGE_RATES_REQUIREMENT.md](/docs/requirements/ADMIN_EXCHANGE_RATES_REQUIREMENT.md): §1 row 1e, D-9, D-10, BQ-2, BQ-3, §5.7 (incl. §5.7.12), FR-35 to FR-55, §8 slice 1e, §13.7, §13.8
**Branch:** `feature/admin-exchange-rates-sync` (worktree `neuronforge-fx-sync`, fast-forwarded to `origin/main` `7e51af5b` on 2026-10-25)
**Date:** 2026-10-25
**Status:** Code Complete (all of 1e built, UNCOMMITTED; awaiting the combined SA code review, then the user's diff and click-through, SA-1e-8 gate)
**Workplan review:** none required (§13.7 verdict; §13.8 "Dev may begin from the step list below"). The user approved on 2026-10-25: "once this is incorporated, dev can begin."

## Overview

Slice 1e adds a **Sync rates** button to the Exchange rates tab on `/admin/finance`. One click makes the server read the European Central Bank's daily reference rates from one fixed URL, derive a per-USD rate for every enabled currency except USD, and answer with a **Suggested rate** and a **Gap** per row. An admin can **Accept** a suggestion row by row through the existing `PATCH`, with a stale check (409) and its own audit event. The D-10 additions put the source and a link to the ECB's page beside the button, write a distinct audit entry for every accepted suggestion, and add a third KPI tile, **Rates last checked**, read from the sync audit. One branch, one PR, seven file-disjoint commits (SQ-52). No migration, no new table, no new dependency. This file replaces the 1e.1-only plan (renamed from `ADMIN_EXCHANGE_RATES_SLICE_1E1_WORKPLAN.md`). The task list is SA §13.8's Dev steps 0 to 14; §13.8 and the D-10 row are quoted verbatim at the end, after the §13.7 text kept from the 1e.1 plan.

## Table of Contents

1. [In plain words](#in-plain-words)
2. [Files to create / modify](#files-to-create--modify)
3. [Task list](#task-list)
4. [Commit plan (RM)](#commit-plan-rm)
5. [Implementation notes](#implementation-notes)
6. [What must stay untouched](#what-must-stay-untouched)
7. [Commands](#commands)
8. [Earlier questions, as built](#earlier-questions-as-built)
9. [Risks](#risks)
10. [Deviations](#deviations)
11. [Checks](#checks)
12. [Verbatim source](#verbatim-source)
13. [SA Review Notes](#sa-review-notes)
14. [QA Testing Report](#qa-testing-report)
15. [Commit Info](#commit-info)
16. [Change History](#change-history)

---

## In plain words

- On Finance → Exchange rates, a new **Sync rates** button appears above the rates table.
- Beside it, always visible: **"Source: European Central Bank (euro foreign exchange reference rates)"**. The source name is a link that opens the ECB's own page in a new tab. Next to it: "Published by the ECB for information only."
- One click makes our server read the ECB's official daily rates (one small public file, no account, no key).
- While it runs the button is greyed out. If the ECB cannot be reached, a plain sentence says why and that no rate was changed.
- After a sync, two columns appear: **Suggested rate** (with "ECB · rates of {date} · fetched {time} UTC") and **Gap** (the difference from our rate, as a number and a %).
- Gap is **red** when the ECB rate is above ours, **green** when below, "No change" when equal, always in words, never colour alone.
- Only enabled currencies other than USD are synced (today ILS, EUR, GBP). USD reads "Base, always 1", a disabled currency reads "Not synced (disabled)", and a currency the ECB does not publish reads "No public rate", never 1.
- Each row with a usable suggestion gets an **Accept suggestion** button. When the suggestion equals our rate it reads **"Confirm (no change)"**: it just refreshes the date.
- If somebody changed that rate since you synced, Accept is refused with **"This rate changed since you synced. Sync again."** and nothing is saved.
- If you edit a rate by hand after a sync, that row reads "Rate changed since the sync. Sync again." instead of showing an out-of-date gap.
- **Two audit entries:** every sync writes a *sync* entry (`EXCHANGE_RATE_SYNC_RUN`: what the ECB said, nothing applied). Every Accept or Confirm writes an *accept* entry (`EXCHANGE_RATE_SUGGESTION_ACCEPTED`: old rate, new rate, the gap the server worked out, and the ECB rate date). Both can be found with the Audit Trail page's Action filter, with no change to that page. A manual edit still writes the usual `EXCHANGE_RATE_UPDATED`.
- A third KPI tile, **Rates last checked**, shows when the last successful sync ran (UTC) and the ECB rate date it brought. It updates the moment a sync succeeds and is still there after a reload. With no sync in the audit it reads **"No sync on record"**. If the audit trail cannot be read it shows **"Could not check"** and the rest of the page still works.

**What will not change:**
- The sync never saves a rate on its own. Only a click on one row's Accept saves, and there is no "Accept all".
- Suggestions disappear on reload or when you leave the tab. Nothing is stored, and there is no database change.
- Manual edit, on / off, filters, history, the two existing KPIs and the rest of Finance work exactly as today. Nothing converts or adds up money.

---

## Files to create / modify

Every file belongs to exactly one commit (see [Commit plan (RM)](#commit-plan-rm)).

| File | Action | Commit | Purpose |
|---|---|---|---|
| `lib/audit/events.ts` | modify | C1 | `EXCHANGE_RATE_SYNC_RUN` and `EXCHANGE_RATE_SUGGESTION_ACCEPTED`, const + metadata (`info`, `SOC2`) |
| `lib/audit/eventAudience.ts` | modify | C1 | Both `'shared'` |
| `lib/audit/__tests__/eventAudience.test.ts` | modify (forced) | C1 | Pin 220 / 60 / 76 / 84 with the SQ-50 comment line |
| `lib/admin/exchangeRates/__fixtures__/ecb-eurofxref-daily-2026-10-23.xml` | create | C2 | The ECB daily file, tabs kept, no backslash; USD `1.1193`, GBP `0.83728`, ILS `3.4939` |
| `lib/admin/exchangeRates/rateSyncRules.ts` | create | C2 | Pure sync contract: SA-1e-4 types, `syncBodySchema`, `SYNC_SOURCE_LABEL`, `SYNC_OUTCOME_TEXT`, direction words, `ECB_SOURCE_LABEL` / `ECB_SOURCE_PAGE_URL` / `ECB_SOURCE_NOTE`, `LastRateSyncWire`, `ExchangeRatesReadPayload`, `lastSyncFromSync` |
| `lib/admin/exchangeRates/rateMath.ts` | create | C2 | `divideHalfUp`, `toFixedPlaces`, `rateGap` on `decimal.ts` primitives |
| `lib/admin/exchangeRates/ecbRates.ts` | create | C2 | `parseEcbDaily` (E1 to E5) and `perUsdRates` |
| `lib/admin/exchangeRates/__tests__/rateSyncRules.test.ts` | create | C2 | Body schema, `lastSyncFromSync`, exact constants |
| `lib/admin/exchangeRates/__tests__/rateMath.test.ts` | create | C2 | Worked values, ties, gap cases |
| `lib/admin/exchangeRates/__tests__/ecbRates.test.ts` | create | C2 | Fixture parse, E1 to E5, per-USD statuses |
| `lib/admin/exchangeRates/ecbFeed.ts` | create | C3 | `server-only`; the copied fetch shape for the one ECB URL |
| `lib/admin/exchangeRates/__tests__/ecbFeed.test.ts` | create | C3 | Injected `fetchImpl`, never the network |
| `app/api/admin/exchange-rates/sync/route.ts` | create | C3 | `POST`: `requireAdmin` first → empty strict body → `listAll` → fetch → parse → gap → `EXCHANGE_RATE_SYNC_RUN` → answer |
| `app/api/admin/exchange-rates/sync/__tests__/route.test.ts` | create | C3 | Route cases |
| `lib/admin/exchangeRates/__tests__/rateSync.source.test.ts` | create | C3 | Source guard with planted controls |
| `lib/repositories/AuditTrailRepository.ts` | modify | C4 | `findLatestAdminExchangeRateSync`, `ADMIN_EXCHANGE_RATE_SYNC_COLUMNS`, the sixth-exception header paragraph |
| `lib/repositories/__tests__/AuditTrailRepository.latestExchangeRateSync.test.ts` | create | C4 | Recording-client unit tests |
| `lib/repositories/__tests__/adminReadMethods.guard.test.ts` | modify | C4 | The name in `ADMIN_METHODS` and the header list |
| `app/api/admin/exchange-rates/route.ts` | modify | C4 | Fourth `Promise.all` member via `settleLastSync()`; answer typed `ExchangeRatesReadPayload` |
| `app/api/admin/exchange-rates/__tests__/route.test.ts` | modify (forced + additions) | C4 | `jest.mock` of `AuditTrailRepository`, `lastSync` in the plain exact body, new cases |
| `lib/admin/exchangeRates/exchangeRateRules.ts` | modify | C5 | `rateOriginSchema`, `expectedRate` / `origin` on the `rate` branch, the `superRefine` |
| `lib/admin/exchangeRates/__tests__/exchangeRateRules.test.ts` | modify (additions) | C5 | New schema cases |
| `app/api/admin/exchange-rates/[currencyCode]/route.ts` | modify | C5 | 409 `rate_changed`; the accepted-suggestion event when `origin` is present |
| `app/api/admin/exchange-rates/[currencyCode]/__tests__/route.test.ts` | modify (additions) | C5 | New cases |
| `app/admin/exchange-rates/components/ExchangeRatesView.tsx` | modify | C6 | Sync button, source line, sync state, accept handler, accepted set, visit `lastSync` |
| `app/admin/exchange-rates/components/ExchangeRatesTable.tsx` | modify | C6 | Optional `sync` prop, two columns, row states, Accept / Confirm |
| `app/admin/exchange-rates/components/ExchangeRatesKpis.tsx` | modify | C6 | Third tile "Rates last checked" |
| `app/admin/exchange-rates/__tests__/exchangeRates.render.test.tsx` | modify (forced + additions) | C6 | `payload()` gains `lastSync`, tile list gains the third id; new describes |
| `app/admin/__tests__/redundantPages.source.guard.test.ts` | modify (forced) | C6 | G-6 `toBe(3)` → `toBe(4)` |
| `app/admin/components/layout/__tests__/KpiStrip.callers.pin.render.test.tsx` | modify (forced) | C6 | Five Exchange rates cases re-hashed, two appended, a dated amendment line |
| `docs/requirements/ADMIN_EXCHANGE_RATES_REQUIREMENT.md` | modify (BA / SA edits, uncommitted) | C7 | Docs |
| `docs/workplans/ADMIN_EXCHANGE_RATES_SLICE_1E_WORKPLAN.md` | create (renamed, untracked) | C7 | This file |

---

## Task list

The §13.8 updated Dev step list. Each step is tagged with its commit.

| # | Step (§13.8) | Commit | Status |
|---|---|---|---|
| 0 | Branch and baseline: `git merge --ff-only origin/main` (90e739be → 7e51af5b, uncommitted docs kept, no stash); rename this workplan and extend it to the whole slice; run the narrow Jest set once and record the counts | — | ✅ |
| 1 | Audit registry: `EXCHANGE_RATE_SYNC_RUN` (SQ-47) and `EXCHANGE_RATE_SUGGESTION_ACCEPTED` (SQ-50) in `events.ts` and `eventAudience.ts` (`'shared'`); pin 220 / 60 / 76 / 84 with the SQ-50 comment line | C1 | ✅ |
| 2 | Fixture, as §13.7 1e.1 step 1 | C2 | ✅ |
| 3 | Sync contract, pure (`rateSyncRules.ts`), header names slice 1e, SQ-42, SQ-49, SQ-52; tests | C2 | ✅ |
| 4 | Rate maths (`rateMath.ts`), as §13.7 1e.1 step 3, with tests | C2 | ✅ |
| 5 | ECB parser (`ecbRates.ts`), as §13.7 1e.1 step 4, statuses from `rateSyncRules.ts`, with tests | C2 | ✅ |
| 6 | ECB fetch (`ecbFeed.ts`), as §13.7 1e.1 step 5 (SQ-35 / SQ-36), with tests | C3 | ✅ |
| 7 | Sync route (`sync/route.ts`), as §13.7 1e.1 step 6 (SQ-39, SQ-47), types from `rateSyncRules.ts`, with route tests | C3 | ✅ |
| 8 | Source guard (`rateSync.source.test.ts`), as §13.7 1e.1 step 9 with the SQ-49 (3) amendments, a planted control per rule | C3 | ✅ |
| 9 | Repository read `findLatestAdminExchangeRateSync` + `ADMIN_EXCHANGE_RATE_SYNC_COLUMNS` (SQ-51 (1)), header's sixth exception, new unit test file, `ADMIN_METHODS` entry | C4 | ✅ |
| 10 | Plain `GET`: fourth `Promise.all` member through `settleLastSync()`, answer `ExchangeRatesReadPayload`, header line; route test forced edits and new cases | C4 | ✅ |
| 11 | `PATCH` rules: `rateOriginSchema`, `expectedRate`, `origin`, the `superRefine` (origin requires expectedRate); `.strict()` kept; additions-only tests | C5 | ✅ |
| 12 | `PATCH` route: 409 `rate_changed`; with `origin` → `EXCHANGE_RATE_SUGGESTION_ACCEPTED` with the SQ-50 (1) details; without → today's event byte for byte; header; additions-only tests | C5 | ✅ |
| 13 | Page: view (sync, source line, visit `lastSync`, Accept, accepted set), table (columns, states, Accept / Confirm), KPIs (third tile); forced edits (G-6, render fixture + tile list, `KpiStrip.callers.pin`); new render cases (1e.1, 1e.2, D-10) | C6 | ✅ |
| 14 | Checks: narrow Jest (incl. price review suites, `filterOptions.guard`, `filterOptions.test` unedited), narrow `tsc`, `eslint`, `lint:hooks`, `git diff --stat` / `--numstat`, untouched list, deviations recorded | — | ✅ |

---

## Commit plan (RM)

SA §13.8 SQ-52. **One PR, seven commits, merged with a merge commit.**

- Every changed file belongs to **exactly one** commit (the table below, and the file → commit column above).
- **Each commit must pass on its own:** its narrow Jest set, plus the cross-cutting guards, plus narrow `tsc` on its files and their importers.
- The RM proves this with a **detached checkout of each commit**: `git checkout --detach <sha>`, run that row's commands, then `git checkout feature/admin-exchange-rates-sync`. **No stash, no interactive rebase, no worktree removal.** If a commit fails, stop before the push and send it back to Dev; rebuild with `git reset --soft <base>` and restage (nothing pushed yet).
- Before the first commit, `git diff --stat` plus `git status --short`: every changed file must appear in exactly one row; stop on any that does not.
- The results go in the PR body.

| # | Conventional Commit | Files (and only these) | Depends on | Narrow test command (from the worktree root) |
|---|---|---|---|---|
| C1 | `feat(audit): register the exchange rate sync and accepted-suggestion events` | `lib/audit/events.ts`, `lib/audit/eventAudience.ts`, `lib/audit/__tests__/eventAudience.test.ts` | — | `npx jest lib/audit/__tests__ app/admin/audit-trail/__tests__/filterOptions.guard.test.ts --ci` |
| C2 | `feat(admin): ECB rate parser, rate maths and the sync contract` | `lib/admin/exchangeRates/rateSyncRules.ts`, `lib/admin/exchangeRates/rateMath.ts`, `lib/admin/exchangeRates/ecbRates.ts`, `lib/admin/exchangeRates/__fixtures__/ecb-eurofxref-daily-2026-10-23.xml`, `lib/admin/exchangeRates/__tests__/rateSyncRules.test.ts`, `lib/admin/exchangeRates/__tests__/rateMath.test.ts`, `lib/admin/exchangeRates/__tests__/ecbRates.test.ts` | — | `npx jest lib/admin/exchangeRates lib/ai/pricing-research/__tests__/decimal.test.ts --ci` |
| C3 | `feat(admin): exchange rate sync route reading the ECB daily feed` | `lib/admin/exchangeRates/ecbFeed.ts`, `lib/admin/exchangeRates/__tests__/ecbFeed.test.ts`, `app/api/admin/exchange-rates/sync/route.ts`, `app/api/admin/exchange-rates/sync/__tests__/route.test.ts`, `lib/admin/exchangeRates/__tests__/rateSync.source.test.ts` | C1, C2 | `npx jest lib/admin/exchangeRates app/api/admin/exchange-rates lib/admin/__tests__/admin-authz-surface.guard.test.ts lib/ai/pricing-research/__tests__/fetchSources.source.test.ts lib/ai/pricing-research/__tests__/fetchSources.test.ts --ci` |
| C4 | `feat(admin): rates last checked, read from the sync audit` | `lib/repositories/AuditTrailRepository.ts`, `lib/repositories/__tests__/AuditTrailRepository.latestExchangeRateSync.test.ts`, `lib/repositories/__tests__/adminReadMethods.guard.test.ts`, `app/api/admin/exchange-rates/route.ts`, `app/api/admin/exchange-rates/__tests__/route.test.ts` | C1, C2 | `npx jest lib/repositories/__tests__/AuditTrailRepository lib/repositories/__tests__/adminReadMethods.guard.test.ts app/api/admin/exchange-rates app/admin/exchange-rates --ci` |
| C5 | `feat(admin): accept a suggested rate with a stale check and its own audit entry` | `lib/admin/exchangeRates/exchangeRateRules.ts`, `lib/admin/exchangeRates/__tests__/exchangeRateRules.test.ts`, `app/api/admin/exchange-rates/[currencyCode]/route.ts`, `app/api/admin/exchange-rates/[currencyCode]/__tests__/route.test.ts` | C1, C2 | `npx jest lib/admin/exchangeRates app/api/admin/exchange-rates app/admin/exchange-rates --ci` |
| C6 | `feat(admin): sync rates, suggestions, gap, accept and last-checked tile on the rates page` | `app/admin/exchange-rates/components/ExchangeRatesView.tsx`, `app/admin/exchange-rates/components/ExchangeRatesTable.tsx`, `app/admin/exchange-rates/components/ExchangeRatesKpis.tsx`, `app/admin/exchange-rates/__tests__/exchangeRates.render.test.tsx`, `app/admin/__tests__/redundantPages.source.guard.test.ts`, `app/admin/components/layout/__tests__/KpiStrip.callers.pin.render.test.tsx` | C2 to C5 | `npx jest app/admin/exchange-rates app/admin/finance app/admin/__tests__ app/admin/components/layout/__tests__/KpiStrip.callers.pin.render.test.tsx lib/admin/exchangeRates --ci` |
| C7 | `docs(admin): exchange rates slice 1e requirement, SA reviews and workplan` | `docs/requirements/ADMIN_EXCHANGE_RATES_REQUIREMENT.md`, `docs/workplans/ADMIN_EXCHANGE_RATES_SLICE_1E_WORKPLAN.md` | — | none (docs only; check: `grep -c '\\' <both files>` shows no backslash-hex text) |

**Narrow `tsc` per commit.** Create a throwaway tsconfig **outside the repo** (for example in the session scratchpad) that extends the root one and includes only that commit's `.ts` / `.tsx` files plus `next-env.d.ts` and `types/**/*.d.ts`; run `npx tsc -p <that file> --noEmit`; then keep only diagnostics whose path is in the commit's file list or imports one of them. The repo carries pre-existing errors elsewhere, and a run that dies (an OOM prints a V8 stack and no diagnostics) is not "clean". The full set of files Dev checked is in [Checks](#checks).

**After the last commit:** the full narrow Jest set in [Commands](#commands) once more on the branch tip.

---

## Implementation notes

How each ruling lands in code. The §13.7 notes from the 1e.1 plan still hold where §13.8 did not change them.

**Sync contract (`rateSyncRules.ts`, SQ-52, SA-1e-4, SQ-49, SQ-51 (4) / (5)).**
- Pure, no `server-only`; imports only from `exchangeRateRules.ts` (existing exports and the type `ExchangeRatesPayload`), never the other way round.
- `syncBodySchema = z.object({}).strict()`; `RateSyncOutcome`, `RateSuggestionStatus`, `GapDirection`, `RateSuggestionWire`, `ExchangeRateSyncPayload` as SA-1e-4.
- `SYNC_SOURCE_LABEL = 'ECB'`; `SYNC_OUTCOME_TEXT` one sentence per outcome (each says no rate was changed); `http_*` shares one sentence naming the status (`syncOutcomeText(outcome)`).
- Direction words: `up` "Rate up: currency weaker, we are behind"; `down` "Rate down: currency stronger, in our favour"; `none` "No change".
- `ECB_SOURCE_LABEL`, `ECB_SOURCE_PAGE_URL`, `ECB_SOURCE_NOTE` with SQ-49's exact values.
- `LastRateSyncWire` (three states), `ExchangeRatesReadPayload = ExchangeRatesPayload & { lastSync }`, `lastSyncFromSync(answer)`.

**`rateMath.ts` (SQ-38, SQ-41, SQ-42).** Imports only `parseDecimal`, `compareDecimals`, `subtractDecimals`, `absDecimal`, `signOfDecimal` and `type Decimal` from `decimal.ts` (unedited). `divideHalfUp` aligns scales with `BigInt(10) ** BigInt(k)` (never `10n`), scales the numerator by 10^(places+1), integer-divides the magnitudes, rounds `(q + 5) / 10` (half away from zero), sign after. No `Math.` at all (the scale comparison is a plain conditional). `rateGap`: `gapAbsolute` 6 places with `+` when positive; `gapPercent` `divideHalfUp(gap × 100, current, 2)` with `%`; `direction` from `compareDecimals` on the exact values.

**`ecbRates.ts` (SA-1e-3, SQ-37).** Anchors E1 to E5 in order, linear patterns, no XML parser. `perUsdRates` returns `suggested` / `not_in_feed` / `no_usable_rate`; never asked for USD.

**`ecbFeed.ts` (SQ-35, SQ-36).** `attempt` / `readCapped` / `discardBody` / the retry loop copied from `fetchSources.ts`, own types, nothing imported from it. 64 KB, `text/xml` / `application/xml`, the RateCheck User-Agent, 10 s, one retry on a network error or 5xx. Logs nothing, never throws. FU-1e-1 recorded in the header.

**Sync route (SQ-39, SQ-47, SA-1e-7).** `requireAdmin` first; correlationId child of `createLogger({ module: 'AdminExchangeRatesSync' })`; body as text (empty → `{}`, bad JSON → 400); strict schema → 400 `invalid_input` "This action takes no input."; `listAll()` (error → 500, no fetch); `fetchEcbDaily()`; parse; `perUsdRates`; `rateGap`; `EXCHANGE_RATE_SYNC_RUN` via `logAndFlush`; one Pino line; 200. `maxDuration = 30`.

**Repository read (SQ-51 (1)).** `findLatestAdminExchangeRateSync(context)`: refuses a missing context before any query; `.select('created_at, rate_date:details->>rateDate')`, `.eq('action', AUDIT_EVENTS.EXCHANGE_RATE_SYNC_RUN)`, `.eq('entity_type', 'exchange_rate')`, `.eq('details->>outcome', 'ok')`, `.order('created_at', { ascending: false })`, `.limit(1)`; a bad `rate_date` is an error; info log with `rows` only; warn on failure; never throws.

**Plain `GET` (SQ-51 (3)).** Fourth member of the existing `Promise.all`, through a module-private `settleLastSync()` that turns a returned error or a throw into `{ status: 'unavailable' }` and logs `warn` with `failed: 'lastSync'`. Never a 500. The `?currency=` branch never calls it.

**`PATCH` (SQ-43, SQ-44, SQ-50).** `rateOriginSchema` strict; on the `rate` branch `expectedRate` and `origin` optional; a `superRefine` on the union refuses `origin` without `expectedRate`. After the pre-read and the 404, `!sameRate(previous.rate_to_usd, expectedRate)` → 409 `{ code: 'rate_changed', error: 'This rate changed since you synced. Sync again.' }`, no write, no audit. With `origin`: `EXCHANGE_RATE_SUGGESTION_ACCEPTED`, details `{ currencyCode, field: 'rate', oldValue, newValue, unchanged, origin, gap: rateGap(oldValue, newValue) }`. Without: today's entry, byte for byte.

**Page (SA-1e-1, SA-1e-2, SQ-49 (4), SQ-51 (5) / (6)).**
- The view owns the sync: one new literal `fetch('/api/admin/exchange-rates/sync', …)`, busy flag, last successful answer, outcome sentence, mounted-request counter (an answer after unmount is dropped).
- An action row between the filter bar and the content holds the button, the source line (link with `target="_blank"`, `rel="noopener noreferrer"`, `aria-hidden` `ExternalLink` icon, `sr-only` " (opens in a new tab)") and the status line "Source: ECB · rates of {rateDate} · fetched {HH:MM} UTC".
- The visit's `lastSync` (from `lastSyncFromSync`) is shown ahead of the `GET`'s; a failed sync leaves it.
- Accept calls the existing `patch` with `{ field: 'rate', rate, expectedRate, origin }`, then the `saveRate` re-reads; success adds the code to the accepted set, which the next sync clears.
- The table's per-row state: USD, disabled, no entry, not in feed, no usable rate, then SA-1e-1 (1) Accepted / (2) gap + Accept or Confirm / (3) rate changed.

---

## What must stay untouched

| Path | Why |
|---|---|
| `lib/ai/pricing-research/fetchSources.ts` and its tests | SQ-36: copied, not lifted |
| `lib/ai/pricing-research/decimal.ts` | SQ-38: reused unedited |
| `lib/ai/pricing-research/**` tests | Must stay green and unedited |
| `lib/services/CurrencyService.ts` | SQ-1: unwired, never imported |
| `package.json`, lockfile | No dependency (SQ-37) |
| `app/admin/finance/**` | The tab is unchanged (§13.8 domain checks) |
| `app/admin/audit-trail/**`, `lib/audit/__tests__/filterOptions.test.ts` | FR-53: the Action filter is catalogue-built; both tests green and unedited |
| `lib/business-os/**` | SQ-42 |
| `lib/repositories/ExchangeRatesRepository.ts` | `listAll()` already exists |
| `supabase/migrations/**` | No migration |

---

## Commands

Run from the worktree root `C:\Users\Barak\My Projects\AgentsPilot\neuronforge-fx-sync`. Nothing is committed and nothing is stashed. `node_modules` is a shared junction and must never be deleted.

```bash
# Narrow Jest: baseline (step 0) and after the build (step 14)
npx jest lib/admin/exchangeRates app/api/admin/exchange-rates app/admin/exchange-rates \
  app/admin/finance app/admin/__tests__ lib/audit/__tests__ \
  lib/admin/__tests__/admin-authz-surface.guard.test.ts \
  lib/ai/pricing-research app/api/admin/model-pricing app/admin/system-config/__tests__ \
  app/admin/components/layout/__tests__/KpiStrip.callers.pin.render.test.tsx \
  lib/business-os/finance/__tests__/finance.source.guard.test.ts \
  lib/repositories/__tests__/adminReadMethods.guard.test.ts \
  lib/repositories/__tests__/AuditTrailRepository \
  app/admin/audit-trail/__tests__/filterOptions.guard.test.ts --ci

# Narrow tsc (scratch tsconfig outside the repo), eslint, hooks gate
npx tsc -p <scratch>/tsconfig.1e.json --noEmit
npx eslint <touched .ts / .tsx files>
npm run lint:hooks

# Handover hygiene
git diff --stat
git diff --numstat     # no deletion-only file
git status --short     # no migration, no package.json / lockfile
```

`lib/audit/__tests__` includes `filterOptions.test.ts`.

---

## Earlier questions, as built

The 1e.1 plan raised Q-1 to Q-4. §13.8 did not rule on them, so the planned choice is built and listed here for the code review.

| # | Point | As built |
|---|---|---|
| Q-1 | The view has no header since slice 2a, and Refresh lives inside the shared `AdminFilterBar` | An action row between the filter bar and the content holds the button, the source line, the outcome and the status line. No shared layout file is edited |
| Q-2 | A currency switched off after the sync | The row's current `isEnabled` wins: "Not synced (disabled)" |
| Q-3 | The × 100 for the gap % | Done locally on the `Decimal` (`units × BigInt(100)`), so the import list is exactly SQ-38's |
| Q-4 | Source line in the cell and by the button | Both |

---

## Risks

| Risk | Mitigation |
|---|---|
| The ECB feed is live and outside our control | Every failure is an outcome, never a throw; a 200 with a plain sentence; the sync writes nothing |
| Tests reaching the network | The committed fixture and an injected `fetchImpl` only; `forbidRealNetwork()` in the feed and route suites |
| A silently dropped currency | E3: the strict count must equal the loose count |
| Float or rounding drift | No `Number(` / `parseFloat` / `parseInt` / `Math.` / `toFixed(` / BigInt literal in the maths, parser or route (source guard) |
| ReDoS or XXE | No XML parser; linear patterns on input capped at 64 KB |
| A stale gap, or an accept against a changed base | SA-1e-1 states on the page; 409 `rate_changed` on the server; `origin` requires `expectedRate` |
| An accept recorded with page-supplied numbers | `gap` and `newValue` are computed or read on the server; `origin` is for the record only |
| The tile breaking the page when the audit read fails | `settleLastSync()` maps any failure to `unavailable`; the `GET` still answers 200 |
| A second outbound host | Approved under RR-8 for this one URL (SQ-35); the page link is navigation only, `ALLOWED_FETCH` still refuses any non-literal `fetch(` |
| Windows CRLF in the fixture | Patterns use `\s`; tests normalise `\r\n`; no backslash in the fixture |

---

## Deviations

Each is small and recorded for the combined SA code review (SA-1e-8). None changes a user decision.

| # | Where | What §13.7 / §13.8 said | What was built, and why |
|---|---|---|---|
| DV-1 | `rateSync.source.test.ts` (C3) | `ECB_SOURCE_PAGE_URL` appears **once** under `app/admin/exchange-rates/**`, as `href={…}` | The rule is **at most once, and every use is `href={ECB_SOURCE_PAGE_URL}`**. The guard lands in C3 and the link in C6, and each commit must be green on its own, so "exactly once" would be red at C3, C4 and C5. "Exactly one link with that `href`" is pinned by the C6 render test (`querySelectorAll('a[href=…]')` has length 1) |
| DV-2 | `app/api/admin/exchange-rates/__tests__/route.test.ts` (C4) | `lastSync` goes into "the two exact bodies (`:173`, `:294`)" | `:294` is the **`?currency=`** body, which must not carry `lastSync` (SQ-51 (3)), so it is unchanged. The second forced edit is the exact-keys pin at `:503` (`Object.keys(plain.data)` gains `lastSync`). The `?currency=` key pin beside it is unchanged |
| DV-3 | `ecbRates.ts` E3 (C2) | The strict count equals the loose `/<Cubes+currency=/g` count | That loose pattern cannot see a swapped attribute order (`<Cube rate=… currency=…/>` does not start with `currency=`), so the swap was a **silent drop**, the very case E3 exists for (the test caught it). **As amended by SA F-1 / QA F-1:** the strict count must now equal BOTH (a) every self-closing `<Cube …/>` tag, `/<Cube[^<>]*/>/g`, whose run excludes `<` as well as `>` so each attempt stops at the next tag (linear: the first version, `[^>]*`, was quadratic, about 0.9 s on the dev machine, 2.6 s in QA and 3.5 s for SA at 64 KB), AND (b) a plain global count of `currency=`, so an explicit-close line `<Cube currency='GBP' rate='0.83728'></Cube>` is E3 instead of a silent drop. A swapped order and an extra attribute also fail E3. Three tests added: a 64 KB adversarial input is E3 in under 250 ms (the limit is tighter than SA's ~1000 ms because the old pattern took about 0.9 s here; the new one takes 1 to 2 ms), the explicit-close GBP line is E3, and the fixture still parses with all 29 currencies |
| DV-4 | Gap chip (C6) | "red / green / none each with words and an icon" | Red (`danger`) and green (`ok`) have their icons. "No change" uses the shared `StatusChip` `neutral` tone, which by that component's own rule has **no icon** (the only tone without one, because it carries no colour meaning, BQ-2 "no colour when equal"). "Accepted" uses `info` (words and an icon) so it never reads as the green "in our favour" |
| DV-5 | `ExchangeRatesView.tsx` (C6) | — | A plain-GET answer **without** `lastSync` is read as `unavailable` ("Could not check", never "No sync on record"). The other existing suites that mount the view (`exchangeRatesFilters.render`, Finance `exchangeRatesTab.render`) serve fixtures without `lastSync`; this keeps them **unedited**, as §13.8 requires |
| DV-6 | `AuditTrailRepository.ts` (C4) | "A `rate_date` that fails `isRealDate` is an error" | Same rule, through a private `isCalendarDate` in the repository (same UTC round trip as `isRealDate`), so the repository imports nothing from `app/` (it would be the first repository to) |
| DV-7 | Sync audit `details.currencies` (C3) | `[{ currencyCode, currentRate, suggestedRate \| null, status }]` | Built exactly so on `ok`. On a source failure the list is **empty**: no feed was read, so there is no `RateSuggestionStatus` to record. The parser anchor (E1 to E5) goes into the route's one log line only, not the answer or the audit |
| DV-8 | Accept accessible name (C6) | "Accept suggested {CODE} rate {rate}" | Built for Accept. For the equal case the name is "Confirm (no change) for {CODE} rate {rate}", so the name starts with the visible label (WCAG 2.5.3, the K-7 rule the admin layout already follows) |
| DV-9 | Sync route (C3) | Invalid JSON → 400 | Same 400 as the strict schema: `{ code: 'invalid_input', error: 'This action takes no input.' }` |
| DV-10 | `[currencyCode]/route.ts` (C5) | — | The existing info log line gains `accepted: boolean`. Log only: the `EXCHANGE_RATE_UPDATED` audit entry of a manual edit is byte for byte today's (pinned by a new test) |
| DV-11 | `KpiStrip.callers.pin` (C6) | Re-hash the five, append two | Done; the case name "A2 ExchangeRatesKpis two tiles" is kept (it now renders three) so no case is renamed. Only the seven Exchange rates hashes moved |
| DV-12 | `eventAudience.test.ts` (C1) | Comment dated "(2026-10-2x)" | Dated 2026-10-25 |

**SA-1e-6 confirmed:** no existing test sends `PATCH /api/admin/exchange-rates/sync` (grep of every `*.test.*` under `app/` and `lib/`). The sync route module exports `POST` only (pinned by a new test).

**`new-api-route` checklist walked (SA-1e-7)** for the sync route and the PATCH change: `requireAdmin` is the first statement (source-pinned in both suites); Zod before any read; correlationId child logger; no `console.*`; repository-only data access (`listAll`, no write method imported); error format with `details` only in development; audit through `logAndFlush` (awaited, never fails the request); integration tests cover 200, 401, 403 and 400. No table, bucket or column, so nothing to classify for the data export.

---

## Checks

| Check | Result |
|---|---|
| Baseline (step 0, before any edit, at `7e51af5b`): narrow Jest set | 114 suites (113 passed, 1 failed); 4,564 tests (4,558 passed, 6 failed). The 6 are in `lib/ai/pricing-research/__tests__/openaiPricingAdapter.test.ts` (A2 to A4 anchors and SA F-5): a **pre-existing local failure** from `core.autocrlf=true` (the fixture is `w/crlf` in this worktree, `i/lf` in the index); CI checks out LF. Unrelated to 1e and left alone |
| Narrow Jest set after the build | ✅ 121 suites (120 passed, 1 failed); 4,842 tests (4,836 passed, 6 failed). The 1 suite and 6 tests are **exactly the baseline** CRLF cases in `openaiPricingAdapter.test.ts`. +7 suites (the 7 new test files), +278 tests |
| Price review suites green (apart from the baseline CRLF case) and unedited | ✅ `lib/ai/pricing-research/**`, `app/api/admin/model-pricing`, `app/admin/system-config/__tests__`: no file changed (`git status`), all green except the baseline case |
| `filterOptions.guard.test.ts` and `lib/audit/__tests__/filterOptions.test.ts` | ✅ green and unedited (FR-53) |
| Narrow `tsc` | ✅ 0 errors. Scratch tsconfig extending the root one, including the 29 touched `.ts` / `.tsx` files (1,046 files checked with their imports); the run exited 0 (no OOM) |
| `eslint` on touched files | ✅ 0 errors. One warning remains, in `lib/audit/events.ts:1796` (`'_'` unused), from 2025-10-21 (`d482d3cef`): not this slice's line |
| `npm run lint:hooks` | ✅ clean (`--max-warnings 0`) |
| G-6 `fetch(` sites in `app/admin/exchange-rates/` | ✅ 4 (the guard's own count, comments stripped) |
| `console.*` in touched and new sources | ✅ 0 |
| Untouched list confirmed; no migration | ✅ `fetchSources.ts`, `decimal.ts`, `CurrencyService.ts`, `package.json`, lockfile, `app/admin/finance/**`, `app/admin/audit-trail/**`, `lib/business-os/**`, `supabase/**`, `ExchangeRatesRepository.ts`: no change |
| No existing test sends `PATCH …/exchange-rates/sync` (SA-1e-6) | ✅ none |
| `git diff --numstat`: no deletion-only file | ✅ every file with deletions has more insertions (largest deletion: 10 lines in `KpiStrip.callers.pin`, the 7 re-hashed lines plus 3 case lines) |
| File → commit map: every changed file in exactly one of C1 to C7 | ✅ 32 changed files, 32 mapped, 0 duplicates, 0 unmapped (C1 3, C2 7, C3 5, C4 5, C5 4, C6 6, C7 2) |

**Test counts (from `jest --json`):** new files: `rateSyncRules.test` 29, `rateMath.test` 18, `ecbRates.test` 25, `ecbFeed.test` 19, sync `route.test` 32, `rateSync.source.test` 60, `AuditTrailRepository.latestExchangeRateSync.test` 13 (196 in all). Render suite 58 → 96 (38 new in the three `slice 1e` describes; 2 forced edits to existing lines). The rest of the +278 are additions to the GET, PATCH and rules suites and the two appended pin cases.

---

## Verbatim source

Quoted with `sed` from the working copy of the requirement (with the uncommitted BA and SA edits), by line range. The text is unchanged.

### §1 Progress, row 1e

| # | Slice | Status | PR | Notes |
|---|---|---|---|---|
| 1e | Rate sync and suggestions (D-9): a **Sync rates** button reads the ECB daily reference rates (user, BQ-3) on the server for every enabled currency except USD; the rates table gains **Suggested rate** (with source, rate date and fetch time) and **Gap** (red when the public rate is above ours, green when below, no colour when equal: user, BQ-2) columns and a per-row **Accept suggestion** that saves through the existing `PATCH`. Nothing is applied automatically; no "Accept all". FR-35 to FR-49 | 🟡 BA scoped 2026-10-25. BQ-2/BQ-3 answered 2026-10-25. **SA §13.7 CLEARED-WITH-CHANGES 2026-10-25** (SQ-35 to SQ-48 ruled, SA-1e-1 to SA-1e-8); Dev builds 1e.1 from the §13.7 step list | — | User request 2026-10-25 (D-9, amends D-1). Proposed split (§5.7.10): **1e.1** server sync + Suggested + Gap (read-only, no write) → **1e.2** Accept per row. No migration if SA accepts option (a), suggestions shown, not stored (SQ-40). New outbound fetch needs its own SA approval (RR-8 of the price review, SQ-35). Full cycle for 1e.1 (new outbound pattern) |

### D-9 (user decision, verbatim)

| # | Topic | Decision | Source (verbatim) | Consequence for this requirement |
|---|---|---|---|---|
| D-9 | Rate sync (**amends D-1**) | A **"Sync rates"** button, like the AI cost check on Model pricing, reads public rates for **every enabled currency** and shows, per row, a **suggested rate** from that public source and a **gap** between our rate and the suggestion, coloured red or green. An admin **accepts a suggestion row by row**. **Nothing is applied automatically** | "ok, last requirement i have here, is i want a sync exchange rate button, similar to the AI cost sync button, where when i click on it, it goes out to the stock market or anywhere public, pulls the rates of all the enables currencies, shows me in a new column the new suggested rate based on that public area, with a button on a row level that enables me to click on accept suggestion. we should also have a gap column, that shows in red if the current was raised (meaning we are losing money) or green if we are making more. have the BA scope it, add to the requirement list and then let's plan for this requirement." (2026-10-25) | D-1 amended: a public feed may now **suggest** a rate; the only writer is still an admin's per-row save through the existing `PATCH` (so `updated_by`, the history trigger and `EXCHANGE_RATE_UPDATED` all apply). No automatic apply, no scheduled sync, no "Accept all" (BA, from "on a row level"). USD is never synced (fixed at 1). New slice 1e (§5.7). **User answers, 2026-10-25:** BQ-2 "Red = public rate higher (Recommended)": **red when the public rate is above ours, green when it is below, no colour when equal**; BQ-3 "ECB daily rate (Recommended)": the **ECB daily reference rate** is the source (no live market quote). D-4 (never assume 1) and D-5 (no conversion) unchanged. SQ-1 holds: `CurrencyService.updateRatesFromApi` stays unwired; the sync is a new server route |

### BQ-2 and BQ-3 (user answers)

**Slice 1e (D-9).** Two questions for the user — **both closed 2026-10-25**:

| # | Question | Default if unanswered |
|---|---|---|
| BQ-2 | **What should red and green mean in the Gap column?** Our rate says how many units of a currency one dollar buys. Example: our shekel rate is 3.09 and the public rate is 3.70. The shekel got weaker: ₪1,000 is really worth $270, not the $324 our table implies, and a $100 price should now be ₪370, not ₪309. So money we receive or price in shekels is worth fewer dollars than we think. Is that "losing money", so **red when the public rate is higher than ours** and **green when it is lower**? | **Yes: red when the public rate is higher than ours (the currency got weaker, we are behind); green when it is lower; "No change" when equal.** This matches "red if the current was raised (meaning we are losing money)". It would flip only if we paid suppliers in that currency, which the platform does not. **✅ Closed 2026-10-25.** User chose "Red = public rate higher (Recommended)": red when the public rate is above ours, green when it is below, no colour when equal |
| BQ-3 | **Which public rate?** A free, official **daily** rate from the European Central Bank (published each working day around 17:00 Israel time, none at weekends; covers the shekel, euro and pound; no account), or a **live market price** that moves all day, which needs a paid data account and a key? | **The ECB's daily official rate.** It is free, official, and enough for a table that is updated once a month (D-2). A live feed is a contract and a secret for no current need. **✅ Closed 2026-10-25.** User chose "ECB daily rate (Recommended)" |

### §5.7

### 5.7 Slice 1e — Rate sync and suggestions (D-9)

The user's 2026-10-25 request (D-9, verbatim in §3): a **Sync rates** button that reads public rates for every enabled currency, a **Suggested rate** column, a **Gap** column in red or green, and an **Accept suggestion** button on each row. Code facts below were read from `origin/main` `90e739be`. Enabled currencies today: **USD, ILS, EUR, GBP**, so the sync covers **ILS, EUR, GBP** (USD is the base, fixed at 1). D-5 holds: nothing converts or totals money (§5.7.5).

#### 5.7.1 The precedent: the AI model price check, and what 1e reuses

The "AI cost sync" the user names is the **Check provider prices** button on `/admin/system-config` ([AI_MODEL_PRICE_REVIEW_REQUIREMENT.md](/docs/requirements/AI_MODEL_PRICE_REVIEW_REQUIREMENT.md), slices 5, 8, 10; SA rulings RR-1 to RR-8).

| Piece | Price review, as built | What 1e reuses |
|---|---|---|
| Button | `app/admin/system-config/components/ProviderPriceCheck.tsx`: disabled and `aria-busy` while a check runs; a refusal shows in the alert box in the server's own words; after a stored check it re-reads the table (`priceFetchRun.ts`) | **The behaviour**, not the component (it is price-specific): a "Sync rates" button in the rates table header, disabled and busy while running, the server's words on failure |
| Outbound fetch | `lib/ai/pricing-research/fetchSources.ts` `fetchLimited`: URLs are code constants (no SSRF surface), `redirect: 'manual'` (a 3xx is an outcome, never followed), only `User-Agent` and `Accept` sent, an honest User-Agent, a 10 s timer over headers **and** body, a byte cap while streaming, one retry on a network error or 5xx, never throws; outcomes `ok`, `http_<status>`, `timeout`, `blocked`, `too_large`; the body is never logged | **The same shape** for one fixed ECB URL. Whether `fetchLimited` is lifted to a shared helper or copied is SQ-36. RR-8 approved outbound fetching **only for the price review**, so 1e needs its own SA approval (SQ-35) |
| Route | `app/api/admin/model-pricing/fetch-runs/route.ts` `POST`: `requireAdmin` first → strict Zod (an empty object) → 60 s refusal (409) → fetches in parallel → deterministic parse → store pending lines → audit `AI_PRICE_FETCH_RUN` with `logAndFlush` → per-source summary. `GET` returns the last run per source | **The order**, minus the storage step (option (a), §5.7.4): `POST /api/admin/exchange-rates/sync`, `requireAdmin` first, strict empty body, fetch, parse, compute, audit with `logAndFlush`, answer |
| Parse | One pure adapter per source, pinned anchors; a missing anchor fails that source with `layout_changed` and **zero** lines; never "the first number found"; prices as decimal strings, never floats (`decimal.ts`) | **Same rules** for a pure ECB parser. `decimal.ts` has no division, and the per-USD rate needs one (SQ-38) |
| Suggested value and gap | `PriceRowCells.tsx` and `coverageColour.ts`: the server computes the gap (basis points) and the colour; the page prints them through `StatusChip` with words and an icon, and does **no number parsing in the browser** (slice 4 RC-8) | **Same split**: the server computes the suggested rate and the gap; the page prints strings; chips carry words and an icon (A-7: never colour alone) |
| Source cell | Each line stores the human `source_url` and `checked_on` | The suggested cell shows the source, the feed's own rate date and the time it was fetched |
| Per-row decision | `PriceDecisionPanel.tsx`: per-row Apply with a pre-filled, editable reason, bulk Apply, Dismiss; the apply RPC locks the line and checks it is not stale; one audit per line | **The per-row idea only.** Accept calls the **existing** `PATCH /api/admin/exchange-rates/<CODE>`, which already validates, sets `updated_by` and `last_updated_at`, fires the history trigger and writes `EXCHANGE_RATE_UPDATED`. No reason field (the `PATCH` has none), no Dismiss (an unaccepted suggestion is simply left), no bulk (D-9) |
| KPIs | `priceKpis.ts` | Not reused: no new tile (§5.7.7) |
| Storage | Round and line tables, RPCs, migrations the user applied by hand: a price drives every customer charge | Not reused under option (a) (§5.7.4) |

#### 5.7.2 Public source options

Checked on 2026-10-25 by a plain fetch. "Stock market": currencies are not traded on a stock exchange; the closest **free, public, citable** figure is a central bank's daily reference rate. A live market quote is not free or public.

| Source | What it is | Key / account | Updated | ILS? | Licence / attribution | Trade-off |
|---|---|---|---|---|---|---|
| **ECB euro reference rates, direct** (`https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml`) | Official reference rates of the European Central Bank | None | Once per working day (TARGET calendar), around 16:00 CET; none at weekends or on TARGET holidays | **Yes** | Free reuse with the source named ("Source: ECB"); the ECB states they are for information only, not for transactions | Official and stable, tiny XML file (29 currencies). **EUR base**, 4 to 5 significant digits. On 2026-10-25 it carried rate date **2026-10-23** (a Friday): USD 1.1193, ILS 3.4939, GBP 0.83728. BGN is no longer listed |
| Frankfurter (`api.frankfurter.dev`) | Open-source relay of the same ECB data, JSON | None | Same as ECB | Yes | Open source; no stated service level | Accepts `base=USD`, but it computes the cross rate itself and rounds to 5 significant digits (2026-10-25: ILS per USD **3.1215**, where ECB's own figures give **3.121505**). A third party between us and the official source |
| open.er-api.com (ExchangeRate-API "open access") | Commercial aggregator's free tier, USD base | None | Daily | Yes | Its terms require a visible attribution link on the page | Not official, blends sources with no published method, rate-limited. Dev verifies the terms at Step 0 if chosen |
| exchangerate.host | Aggregator | **Now needs an API key** (sign-up) | — | — | — | **Excluded**: a secret to store and rotate |
| Bank of Israel representative rate | Official ILS per USD | None | Working days | ILS only | Official | Good for ILS alone, but a second source for one currency. Not now |
| Live market quote (paid market-data vendors) | Intraday trading prices | **Account, API key and a data licence** | Continuous | Yes | Contract terms | Out of scope: a paid contract and a secret. Free "unofficial" endpoints scraped from finance sites break their terms and are not considered |

**BA recommendation: ECB reference rates, read directly from the ECB** (SQ-37). It is the official source, like RR-1's "official source only" rule for prices; it needs no key; it covers all three currencies we sync; and deriving the per-USD rate ourselves keeps 6 decimals. Frankfurter is the acceptable alternative if SA prefers JSON. **The user confirmed the ECB daily rate on 2026-10-25 (BQ-3, "ECB daily rate (Recommended)")**; the endpoint (ECB direct or Frankfurter) stays SA's (SQ-37).

**From EUR base to per USD.** The ECB gives units per 1 EUR. Our `rate_to_usd` is units per 1 USD, so: rate(X) = ECB(X) ÷ ECB(USD), and rate(EUR) = 1 ÷ ECB(USD), rounded **half-up to 6 decimals**. This is arithmetic on two rates from the same feed, never on an amount of money (§5.7.5, SQ-42). With the 2026-10-23 figures: ILS 3.4939 ÷ 1.1193 = **3.121505**; GBP 0.83728 ÷ 1.1193 = **0.748039**; EUR 1 ÷ 1.1193 = **0.893416**. If the feed has no USD entry (the divisor), the whole sync fails with `layout_changed` and suggests nothing.

**Time and weekends.** The cell always shows the feed's own **rate date** ("ECB rates of 2026-10-23"), so a Sunday sync can never pass Friday's rate off as today's. Before about 16:00 CET the newest file is the previous working day's.

#### 5.7.3 Where the fetch happens

- **Server only.** A new admin route, BA suggests `POST /api/admin/exchange-rates/sync` (SQ-39). `requireAdmin` is the first statement; the body is a strict empty object, so no URL, currency list or rate can be supplied; Node runtime.
- **The server decides what to sync:** it reads the enabled currencies through `ExchangeRatesRepository`, never from the page, and leaves USD out.
- **The fetch** follows the precedent (§5.7.1), copied rather than lifted (SQ-36): one fixed URL constant in `lib/admin/exchangeRates/ecbFeed.ts`, a 10 s timeout over headers and body, a **64 KB** byte cap (the file is about 1.8 KB), accepted content types **`text/xml` and `application/xml`** only (`text/html` and 403 are `blocked`), manual redirects, `cache: 'no-store'`, only `User-Agent` and `Accept` sent, User-Agent **`AgentPilot-RateCheck/1.0`** (admin-triggered exchange rate review; one request per click), one retry on a network error or 5xx, no secrets (SQ-35).
- **The route** (`app/api/admin/exchange-rates/sync/route.ts`) has `requireAdmin` as its **first statement**, then Zod on the body before any read (SQ-39). `runtime = 'nodejs'`, `maxDuration = 30`.
- **The answer** carries the source name, the rate date, `fetchedAt`, and per synced currency: the current rate as read, the suggested rate or a reason it has none, and the gap with its direction (§5.7.5). A source failure is still a 200 with its outcome, like the price check, so the page can say why in plain words; anything unexpected is a 500 with the standard error format.
- **Audit:** a new event, BA name `EXCHANGE_RATE_SYNC_RUN` (registered, severity info), written with `logAndFlush`: source, rate date, outcome, and per currency the current and suggested rate. No person's data beyond the acting admin. Under option (a) this is the **durable record of what the feed said** (SQ-47).
- **Logging:** Pino, `createLogger({ module: ... })` with a `correlationId` child; one line per sync (outcome, duration, bytes, currency count). The feed body is never logged.
- **Failure never breaks the page.** The rates table, edit, on / off, filters, history and KPIs keep working. The message sits by the button, for example: "Could not reach the ECB (timed out). No rate was changed. You can still edit a rate by hand."
- **Legacy code:** the sync does not import or wire `CurrencyService.updateRatesFromApi` (SQ-1). That legacy path also wrote floats and applied rates with no review: both are what 1e avoids.

#### 5.7.4 Suggestions: shown only, or stored?

| | (a) Shown only (**BA recommendation**) | (b) Stored |
|---|---|---|
| What it is | The suggestions live in the page until it is reloaded or the tab is left | A new table holding each sync's suggestions with source, rate date and fetched-at |
| Record of what the feed said | The `EXCHANGE_RATE_SYNC_RUN` audit entry; the accept itself is audited by `EXCHANGE_RATE_UPDATED` | The table and the audit |
| Build cost | No migration, no new table, no lockdown | A migration the user applies by hand on prod, a 1b-style lockdown, grants, a checker, a repository |
| Cost to the admin | After a reload, click Sync again (about a second) | None |

**Why (a), although the price review stored its results:** the price review stores pending lines because a price drives **every customer charge**, so it needs frozen evidence, a stale check inside an RPC and per-line state. A rate here drives **nothing** (D-5): an accepted suggestion is an ordinary admin edit that the existing route already records. (a) reuses what exists; (b) can be added later if the user wants suggestions to survive a reload or be seen by another admin (SQ-40).

#### 5.7.5 The two new columns, and the gap

**Placement.** After "Rate to USD": **Suggested rate**, then **Gap**. "Accept suggestion" joins the row's Actions. BA default: the two columns appear **after the first sync of the visit**, so the table before a sync is exactly today's (SQ-48).

**Suggested rate cell.** The rate as the server's 6-decimal string, with a second line: "ECB · rates of 2026-10-23 · fetched 09:14 UTC".

| Row | Suggested rate | Gap | Accept |
|---|---|---|---|
| USD | "Base, always 1" | — | None |
| Enabled, in the feed | The rate | The gap | Yes |
| Enabled, **not in the feed** | "No public rate" (never 1, D-4; never borrowed from another source) | — | None |
| Enabled, result not storable (rounds to 0 or exceeds `RATE_MAX`) | "No usable rate" | — | None |
| Disabled | "Not synced (disabled)" | — | None |
| Switched on after the sync | "Sync again to get a rate" | — | None |
| Accepted, or now holds the suggested rate (SA-1e-1 state 1) | The rate | "Accepted" | None |
| **Rate changed since the sync** (the row no longer holds the rate the sync compared against, and not the suggestion either; SA-1e-1 state 3) | The rate | "Rate changed since the sync. Sync again." (no colour) | None |

**Gap: definition (BA default).** Gap = **suggested − current**, shown both as an absolute figure (6 decimals, signed) and as a **% of the current rate** (2 decimals, signed). The server computes it with decimal arithmetic (no float) and the page prints it. "No change" when the two are equal at 6 decimals (`sameRate`). No tolerance band: any difference is coloured (SQ-41). **The direction and colour come from the exact comparison of the two rates (`compareDecimals`), never from the rounded %** (SA, SQ-41): a gap of `+0.000001` reads `+0.00%` and is still red.

**What "losing money" means for a per-USD rate.** `rate_to_usd` is how many units of a currency one US dollar buys. A **higher** suggested rate means the currency got **weaker** against the dollar: any amount held, earned or priced in that currency is worth **fewer dollars** than our table says.

> **Worked example.** Our ILS rate is **3.09**; the suggestion is **3.70** ILS per USD. Gap **+0.610000 (+19.74%)**.
> - ₪1,000 is worth $323.62 at 3.09 but only $270.27 at 3.70. With our old rate, a shekel amount looks about $53 bigger than it really is.
> - The other way round: at 3.09, a $100 price is ₪309; at today's rate it should be ₪370. Asking ₪309 would leave about $16.50 on the table.
> - Either way, money in shekels buys fewer dollars than we think: **red**.
>
> These money figures only explain the colour. **The page shows no amount and converts nothing** (D-5).

**Colour (decided by the user 2026-10-25, BQ-2: "Red = public rate higher (Recommended)"):**

| Case | Colour | Words (with an icon) |
|---|---|---|
| Suggested **higher** than ours | **Red** | "Rate up: currency weaker, we are behind" |
| Suggested **lower** than ours | **Green** | "Rate down: currency stronger, in our favour" |
| Equal at 6 decimals | No colour | "No change" |

This matches the user's words, "red if the current was raised (meaning we are losing money)". It is right when money is **received or priced in the foreign currency**, which is the platform's case (the AI costs are in USD). It would flip only if we **paid** suppliers in the foreign currency. **Confirmed by the user 2026-10-25 (BQ-2).**

**D-5 and the CLAUDE.md rule.** "No figure may be converted or summed with" the rates. The gap compares **two rates of the same currency**, and the EUR-to-USD step divides one feed rate by another. Neither converts or sums an amount of money, and no USD figure appears. The BA reads both as allowed; **SA rules (SQ-42)**. No new code goes under `lib/business-os/`, so `finance.source.guard` is unaffected.

#### 5.7.6 Accept suggestion (per row)

- **Button** on each row that has a usable suggestion, named for screen readers, for example "Accept suggested ILS rate 3.121505".
- **One click saves** through the existing `PATCH /api/admin/exchange-rates/<CODE>` with `{ "field": "rate", "rate": "<suggested string>" }`. This brings the existing rule check (`RATE_PATTERN`, > 0), `updated_by` = the admin, `last_updated_at` = now, the history trigger (when the rate differs) and the `EXCHANGE_RATE_UPDATED` audit with the old and new value. The suggested string already meets the rules (rounded half-up to 6 decimals, > 0, at most `RATE_MAX`); a row whose value cannot is never offered a button.
- **Equal suggestion:** the button reads "Confirm (no change)". Saving the same value is already "confirmed for this month" (SA-R7): the date refreshes and no history row is written. This is a quick way to clear a Stale chip.
- **After the save:** the existing re-reads run; the row shows "Accepted" (string equality, no arithmetic in the page) and its Stale chip clears.
- **No "Accept all".** The user asked for row level, and one click per currency keeps each change a deliberate admin act. With three synced currencies it costs three clicks. Revisit if many currencies are enabled.
- **Provenance and concurrency** are SA's: whether the `PATCH` body gains an optional, strict field recording "from sync, ECB, rate date …" in the audit (SQ-43), and whether Accept sends the rate it was compared against, so a rate changed by another admin since the sync is refused with 409 (SQ-44).

#### 5.7.7 Interaction with existing features

| Feature | Effect |
|---|---|
| Stale chip (FR-8) | Accepting (or confirming) refreshes `last_updated_at`, so the chip clears, as with any save |
| Show / Search filter (FR-14 to FR-16) | The server syncs **enabled** currencies only, whatever the filter shows. Under Disabled only or All, disabled rows read "Not synced (disabled)". The filter never changes what is synced |
| Held rows (SQ-9) | Unchanged. Suggestions are keyed by currency code in page state; they survive Refresh, a save and a filter change, and are gone on reload or on leaving the tab (SQ-30 precedent). **SA-1e-1:** the answer carries, per currency, the `currentRate` the server compared against, and the page picks each row's state by string comparison with `sameRate`: (1) **"Accepted"**, no button, when the code is in the page's accepted set (1e.2; set by a successful Accept or Confirm, cleared by the next sync) or the row now holds the suggested rate (where that differs from the sync's base); else (2) **the gap as served**, with Accept or "Confirm (no change)" (1e.2), when the row still holds the sync's base rate; else (3) **"Rate changed since the sync. Sync again."**, with no gap colour and no button |
| History window (D-8) | An accept that changes the rate writes a history row through the trigger; it shows under the default This month and updates the "Last rate change" tile through the existing re-reads |
| KPIs | **No new tile.** "Enabled currencies" and "Last rate change" are unchanged. A "rates out of tolerance" tile is not recommended: it would need a threshold and a stored sync, and the Gap column already says it row by row. The sync line under the button (source, rate date, fetched at) is the status. Flagged against the money-page KPI-first preference (SQ-45) |
| Finance tab | The button lives inside the rates view; no file under `app/admin/finance/` changes; sync state is page state, never in the URL (SQ-25 precedent) |
| Guards | `redundantPages` G-6: the folder's literal `fetch(` count goes **3 → 4** (the new `POST` targets `/api/admin/exchange-rates/sync`, which `ALLOWED_FETCH` already accepts). The page still calls only our own route, never an outside host |

#### 5.7.8 Rate limits and caching

- The ECB publishes once a day, needs no key and serves a tiny file. One request per click is far below any reasonable limit.
- The button is disabled while a sync runs, and while there is no successful read of the rates yet (SA-1e-2). That is the only guard against repeat clicks.
- **No server cache and no refusal window (SA, SQ-46 rejected).** A per-instance cache on Vercel would disagree between instances and add state for no real saving (about 2 KB from a CDN that already sends `max-age=300`), and there are no stored runs to measure a 60 s window against. Every answer is a fresh fetch with its own `fetchedAt`.
- No scheduled sync, no cron (D-9: a click).

#### 5.7.9 When the feed lacks a currency

"No public rate", no gap, no Accept. Never 1 (D-4), never a guess, never a second source. All three currencies synced today are in the ECB feed; some of the 43 currencies in the table are not, which matters only if they are enabled later.

#### 5.7.10 Proposed split (small numbered slices)

| Part | Delivers | Touches | Cycle |
|---|---|---|---|
| **1e.1** | The Sync button, the server route (fetch, parse, per-USD rate, gap), the audit event, the Suggested rate and Gap columns with every state in §5.7.5. **Read-only: nothing is written to `exchange_rates`** | New route + its tests; new pure parser and rate math (+ fixtures, no network in CI); `exchangeRateRules.ts` (shared types); `ExchangeRatesView`, `ExchangeRatesTable`; `lib/audit/events.ts`; G-6 count | **Full cycle** (a new outbound pattern, SA approval under SQ-35) |
| **1e.2** | Accept suggestion per row, "Confirm (no change)", the Accepted state; SQ-43 / SQ-44 if SA rules them in | `ExchangeRatesTable` / `ExchangeRatesView`; the `PATCH` route only if SQ-43 / SQ-44 add a field | Full cycle if the `PATCH` changes, else TL may choose the short path |

**Order: 1e.1 → 1e.2**, each from `origin/main`, not stacked. Under option (a) neither has a migration or a prod step.

#### 5.7.11 Unchanged by 1e

- Manual edit and on / off (FR-2, FR-3); USD fixed at 1 (FR-4); D-3 (admin only), D-4, D-5.
- The 1b lockdown, the history trigger, `HISTORY_LIMIT`, the name lookup, the history window, both KPI tiles.
- `CurrencyService` (unwired, SQ-1), `CurrencySelector`, `currencyHelpers`.
- `app/admin/finance/**`, `lib/business-os/**`, `finance.source.guard`, `KpiStrip.callers.pin` (no KPI change).
- The price review's own code: reused only as SA rules in SQ-36; its tests stay unedited.

### FR-35 to FR-44 (the 1e.1 FRs)

| # | Requirement | Slice |
|---|---|---|
| FR-35 | A **Sync rates** button sits in the rates table header; it is disabled and busy while a sync runs (D-9, §5.7.1) | 1e.1 |
| FR-36 | The sync runs **on the server only**, through an admin route with `requireAdmin` first and a strict empty body. The server picks the enabled currencies other than USD from the database, and fetches one fixed public source URL with a timeout, a byte cap, manual redirects and no secrets (§5.7.3) | 1e.1 |
| FR-37 | The per-USD suggested rate is derived from the feed with decimal arithmetic (no float), rounded half-up to 6 decimals, and must pass `RATE_PATTERN` and be > 0; otherwise the row reads "No usable rate" (§5.7.2) | 1e.1 |
| FR-38 | A **Suggested rate** column shows the rate, the source, the feed's rate date and the fetch time (UTC). It appears after the first sync of the visit (§5.7.5, SQ-48) | 1e.1 |
| FR-39 | A **Gap** column shows suggested − current as a signed absolute (6 decimals) and a signed % of the current rate (2 decimals), computed on the server. Red when the suggestion is above the current rate, green when below, no colour when equal (BQ-2, user 2026-10-25), always with words and an icon; "No change" when equal at 6 decimals (§5.7.5) | 1e.1 |
| FR-40 | A currency the feed does not carry shows "No public rate", with no gap and no Accept. It is never treated as 1 (D-4) and never filled from another source | 1e.1 |
| FR-41 | A failed sync (timeout, HTTP error, blocked, too large, layout changed) shows a plain message with the reason by the button; no rate changes; the rest of the page keeps working | 1e.1 |
| FR-42 | Every sync writes one audit entry (BA name `EXCHANGE_RATE_SYNC_RUN`, durable via `logAndFlush`) and one Pino line; the feed body is never logged or audited | 1e.1 |
| FR-43 | Suggestions are page state (option (a), SQ-40): they survive Refresh, a save and a filter change, and are gone on reload or on leaving the tab. Nothing is stored. **Amended by SA-1e-1:** a gap is shown only while the row still holds the rate the sync compared against. Each row is in one of three states, compared as strings with `sameRate` (no arithmetic in the page): (1) **"Accepted"**: the row was accepted (1e.2), or it now holds the suggested rate; (2) **the gap**, with Accept or "Confirm (no change)" (1e.2); (3) **"Rate changed since the sync. Sync again."**, with no gap colour and no button | 1e.1 |
| FR-44 | Disabled currencies are not synced, whatever the Show filter shows; they read "Not synced (disabled)" | 1e.1 |

### §8 Slice 1e.1

### Slice 1e — Rate sync and suggestions (FR-35 to FR-49)

**1e.1 — sync, Suggested rate, Gap (read-only)**

- [ ] On `/admin/finance?tab=exchange-rates`, the rates table header has a **Sync rates** button; while a sync runs it is disabled and `aria-busy`.
- [ ] A sync as a platform admin returns suggestions for **ILS, EUR, GBP** only (the enabled currencies other than USD, read by the server); USD reads "Base, always 1"; a disabled currency reads "Not synced (disabled)" under Show = All.
- [ ] Route tests: non-admin → refused, no outside fetch made; any body key (a URL, a currency list, a rate) → 400, no fetch made; happy path from a committed fixture → 200 with source, rate date, `fetchedAt` and one entry per synced currency.
- [ ] Parser and rate tests (pure, fixtures, no network): with the 2026-10-23 ECB figures, ILS → `3.121505`, GBP → `0.748039`, EUR → `0.893416`; half-up rounding at the 7th decimal; no float anywhere (a source test pins it); feed without USD → `layout_changed` and no suggestions; renamed or missing element → `layout_changed`; a currency missing from the feed → "No public rate", never `1`.
- [ ] Gap tests: suggested − current, absolute (6 decimals, signed) and % of current (2 decimals, signed). Worked case: current `3.09`, suggested `3.70` → `+0.610000`, `+19.74%`, **red** (BQ-2); a suggestion below the current rate → **green**; equal at 6 decimals → "No change", no colour. Every coloured chip has words and an icon.
- [ ] The suggested cell shows the source, the feed's **rate date** and the fetch time in UTC; a weekend sync shows the last working day's date.
- [ ] Fetch failures (timeout, 5xx after one retry, 4xx, 3xx, `text/html`, over the byte cap) each give their own plain message by the button; the table, edit, on / off, filters, history and KPIs keep working; no rate changes (render test).
- [ ] One `EXCHANGE_RATE_SYNC_RUN` audit entry per sync, written with `logAndFlush`, holding source, rate date, outcome and per-currency current and suggested rates; an audit failure does not fail the sync. No log line or audit entry holds the feed body.
- [ ] Nothing is written to `exchange_rates` or `exchange_rate_history` by the sync (route test: no repository write method called). No migration.
- [ ] Suggestions survive Refresh, a rate save and a Show / Search change; they are gone after a reload or after leaving the tab.
- [ ] Before the first sync of the visit the table renders exactly as today (existing render tests unedited, per the SQ-48 ruling).
- [ ] **SA-1e-1 row states** (render test, string comparison through `sameRate`, no number parsing): a row that still holds the sync's base rate shows the gap; after a manual edit to another value it shows "Rate changed since the sync. Sync again." with no gap colour; after a manual edit to the suggested value it shows "Accepted".
- [ ] **Parser anchors E1 to E5** each fail the sync with `layout_changed` naming their own anchor, each built by a string replacement on the one fixture: E1 the `<gesmes:name>European Central Bank</gesmes:name>` line missing; E2 no `Cube time` or two of them, or an unreal date; E3 a rate line in another shape (for example swapped attribute order) — it fails loudly, never drops a currency silently; E4 a code twice; E5 no USD, or USD at zero. A zero rate for another currency is that row's "No usable rate", not a feed failure.
- [ ] **Fetch limits** (injected fetch, no network): a declared `content-length` over **64 KB** → `too_large`, body unread; a streamed body over 64 KB → `too_large`; `text/html` or 403 → `blocked`; another content type (for example `application/json`) → `layout_changed`; only `User-Agent` (`AgentPilot-RateCheck/1.0 …`) and `Accept` sent, `redirect: 'manual'`, `cache: 'no-store'`; no server cache: two syncs make two fetches.
- [ ] Colour from the exact comparison: a `+0.000001` gap reads `+0.00%` and is red.
- [ ] `PATCH /api/admin/exchange-rates/sync` answers **405** once the sync route exists (static segment wins; SA-1e-6); no existing test sends it.
- [ ] The `rateSync.source.test.ts` guard is green: `fetch(` exactly once in `ecbFeed.ts`, the ECB URL the only `https://` literal, no `Number(` / `parseFloat` / `Math.` / `toFixed(` / BigInt literal in the rate math, parser or route, no import of `pricing-research/fetchSources`, `CurrencyService` or `lib/business-os/**`. `lib/ai/pricing-research/**` and its tests are unedited.
- [ ] `redundantPages` G-6 literal `fetch(` count **3 → 4**, the new site targeting `/api/admin/exchange-rates/sync`; the page calls no outside host. `finance.source.guard`, `KpiStrip.callers.pin` and every file under `app/admin/finance/` unchanged. `CurrencyService` not imported by any new file.

### §13.7 SA review: slice 1e (all of it)

### 13.7 SA review: slice 1e

**Reviewed by SA — 2026-10-25.** This is a requirement review of the §1 1e row, D-9, §5.7, FR-35 to FR-49, the 1e NFR line, the §8 slice 1e criteria, BQ-2 / BQ-3 and the §12 1e rows. Code was read from `feature/admin-exchange-rates-sync` at `origin/main` `90e739be`. The ECB endpoint was probed once on 2026-10-25.

**Verdict: CLEARED-WITH-CHANGES. Dev builds from the step lists below; there is no separate workplan review.** The slice is proportionate. It has no migration, no table, no new dependency, no new repository method and no write path in 1e.1. It reuses the existing `PATCH` for the accept. The one new thing is a second fixed outbound URL, approved here under RR-8's shape (SQ-35).

Three BA proposals change:
- **SQ-36.** Copy the fetch shape; do not lift it.
- **SQ-46.** No server cache.
- **SQ-38.** Reuse the pure `decimal.ts` primitives, and add only the division.

Six gaps the BA did not list are added as SA-1e-1 to SA-1e-6. The biggest is SA-1e-1: a gap computed against a rate that has since been edited.

**Split confirmed:** 1e.1, then 1e.2, each from `origin/main`, not stacked. 1e.1 is read-only and ships alone. 1e.2 changes the `PATCH` (SQ-43, SQ-44), so it is a full cycle too.

**User decisions, not reopened (D-9, BQ-2, BQ-3):**
- A sync button reads public rates for the enabled currencies.
- A Suggested rate column, and a per-row Accept suggestion. No auto-apply, no "Accept all".
- Gap: red when the public rate is above ours, green when below, no colour when equal.
- Source: the ECB daily reference rate.

**Verified against the code:**

| Claim | Result |
|---|---|
| `fetchLimited` shape (§5.7.1) | ✅ `lib/ai/pricing-research/fetchSources.ts`. Facts: `import 'server-only'`; code-constant URLs; `redirect: 'manual'`, `cache: 'no-store'`, only `User-Agent` and `Accept`; a 10 s timer over headers and body; a `content-length` pre-check, then a streaming byte cap; 403 and `text/html` → `blocked`; an unlisted content type → `layout_changed`; one retry on `network_error` or 5xx; never throws. It is **typed to the price review**: `PriceSource.id: AdapterProvider \| 'litellm'`, and it uses the fixed `PRICE_CHECK_USER_AGENT` |
| The price review's own guard | ⚠️ `fetchSources.source.test.ts` "one outbound door (SC-9)" scans every `.ts` file in `lib/ai/pricing-research/` plus the fetch route. It pins `fetch(` to **exactly 1** in `fetchSources.ts`, and pins that file's full URL literals to the five price constants. Lifting the core out would make that file's count 0, so the guard would have to be edited. That breaks the BA's own condition ("tests stay unedited") (SQ-36) |
| RR-8 | ✅ "Outbound fetching of third-party content from a serverless route is approved **only in this shape and for this feature** … Any reuse elsewhere needs its own SA review." The slice 10 ruling (O-7) is the precedent for approving one more URL under the same shape. **This review is the RR-8 review for 1e.** It is a reuse of an approved pattern, not a new one under CLAUDE.md rule 7 |
| `fetch-runs` route order | ✅ `correlationId` → `requireAdmin` → body read as text, so an empty body is `{}` → strict `z.object({}).strict()` → 60 s refusal (stored runs) → parallel fetch via `allSettled` + `settledToResult` → parse → store → `logAndFlush` → summary. `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 60`. A source failure is a 200 with its outcome. 1e keeps this order without the refusal and the store |
| ECB endpoint (SQ-37) | ✅ Probed 2026-10-25: `GET https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` → **200 directly** (no redirect, so `redirect: 'manual'` is safe), `Content-Type: text/xml`, chunked (no `content-length`, so the streaming cap is the one that applies), `cache-control: max-age=300`, about 1.8 KB. The body is the `gesmes:Envelope`: `<gesmes:name>European Central Bank</gesmes:name>`, then one `<Cube time='2026-10-23'>` holding `<Cube currency='USD' rate='1.1193'/>` lines. Single quotes, tab-indented, no backslash. USD 1.1193, GBP 0.83728, ILS 3.4939 match §5.7.2 |
| Worked values (§5.7.2, §8) | ✅ 3.4939 ÷ 1.1193 = 3.12150451… → **3.121505**. The 7th decimal is a 5, so this case exercises half-up. 0.83728 ÷ 1.1193 = 0.74803895… → **0.748039**. 1 ÷ 1.1193 = 0.89341552… → **0.893416**. (3.70 − 3.09) ÷ 3.09 = 19.7411% → **+19.74%** |
| BigInt (SQ-38) | ✅ `tsconfig.json`: `target: "ES2017"`, `lib: ["dom", "dom.iterable", "esnext"]`. The `bigint` type and `BigInt(...)` calls are available. **BigInt literals (`10n`) are a TS2737 error below ES2020**, and Jest runs `ts-jest` on this tsconfig, so they would fail there too. `decimal.ts` already follows this rule: it uses `BigInt(10)` and `BigInt(10) ** BigInt(n)`, never `10n`. `decimal.ts` is pure (no I/O, no `server-only`), exports `parseDecimal`, `compareDecimals`, `subtractDecimals`, `absDecimal` and `signOfDecimal`, has **no division**, and is already imported outside its folder (`lib/repositories/types.ts`). `incrementDigits` in `exchangeRateRules.ts` is private string arithmetic, used by `roundRateForDisplay` |
| Route path (SQ-39) | ✅ `app/api/admin/exchange-rates/` holds `route.ts` (GET) and `[currencyCode]/route.ts` (PATCH only). In the App Router a static segment (`sync/`) wins over a dynamic sibling (`[currencyCode]/`), and `sync` (4 letters, lower case) can never pass `CURRENCY_CODE_PATTERN` `^[A-Z]{3}$`. One side effect: `PATCH /api/admin/exchange-rates/sync` changes from 400 ("Invalid currency code") to 405 (the static route has no PATCH). That is harmless; no test sends it (grep) (SA-1e-6) |
| Admin authz surface guard | ✅ `lib/admin/__tests__/admin-authz-surface.guard.test.ts` checks by shape, repo-wide, and has no handler-count pin. A new `route.ts` under `app/api/admin/**` passes if its handler calls `requireAdmin(`. CLAUDE.md requires that call to be the **first statement**. The `[currencyCode]` PATCH follows that; `fetch-runs` computes `correlationId` first. 1e follows the PATCH |
| G-6 (`redundantPages.source.guard`) | ✅ `` ALLOWED_FETCH = /^\s*(['"`])\/api\/admin\/exchange-rates(['"`/?]\|\$\{)/ ``: `'/api/admin/exchange-rates/sync'` passes on the `/` branch. The count pin (`toBe(3)`, "one read, one per-currency read and one write") becomes **4** in 1e.1. **Also:** `EXCHANGE_BANS` forbids `https?://` in every non-test file under `app/admin/exchange-rates/`, so the page may not hold the ECB URL or link to it (SA-1e-5). 1e.2 adds **no** `fetch(`: Accept reuses the existing `patch` callback |
| Audit registry (SQ-47) | ✅ `EXCHANGE_RATE_*` live in `lib/audit/events.ts` (the const at 398-399, metadata at 1206-1215: `info`, `SOC2`) and in `lib/audit/eventAudience.ts` as `'shared'` (141-142). The pin is in `lib/audit/__tests__/eventAudience.test.ts:82`, "60 Business OS, 74 shared, 84 AgentsPilot", `toHaveLength(218)`, with a dated `+n` comment per change. No other test pins the total (grep `218`). `AUDIT_ENTITY_TYPES` already has `'exchange_rate'` (`lib/audit/types.ts:127`). `logAndFlush(entry, logger, { reason, continues })` is used by the PATCH |
| `PATCH` body (SQ-43, SQ-44) | ✅ `patchBodySchema = z.discriminatedUnion('field', [rate .strict(), enabled .strict()])`. The route pre-reads (`findByCode`), then makes one update, then audits `{ currencyCode, field, oldValue, newValue }`. The view's single `patch(currencyCode, body: ExchangeRatePatchBody)` callback (`ExchangeRatesView.tsx:333`) is the only PATCH site, and `saveRate` builds `{ field: 'rate', rate }`. Optional keys on the `rate` branch alone leave both existing shapes valid, and every other unknown key is still refused |
| Schema facts | ✅ `20261082`: `rate_to_usd numeric(12,6) NOT NULL`, `CHECK (rate_to_usd > 0)`, `is_enabled boolean DEFAULT true` (nullable; the wire reads null as false). A current rate is never null, so a gap always has a base, and its % never divides by zero |
| Repository | ✅ `ExchangeRatesRepository.listAll()` exists, carries the documented rule 4 exemption (global table, no owner column, admin-only, service role intentional), and is the only read the sync needs. No new method, so `adminReadMethods.guard` is unaffected |
| Finance guards | ✅ `finance.source.guard` forbids `exchange_rates` in `lib/business-os/finance/**` (lines 452-453, 948). The `app/admin/finance/**` files name the **tab** (`exchange-rates`), never the table. 1e touches neither tree |
| `console.*` in touched files | ✅ 0 in all of: the four view components, both rates routes, `exchangeRateRules.ts`, `events.ts`, `eventAudience.ts` |

#### Rulings

| # | Ruling |
|---|---|
| SQ-35 | **Approved under RR-8**, as the second feature allowed to fetch from a serverless route. The URL is exactly `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml`, a code constant in **one** file (`lib/admin/exchangeRates/ecbFeed.ts`, `import 'server-only'`). The shape is unchanged: `redirect: 'manual'` (any 3xx is `http_3xx`); `cache: 'no-store'`; only `User-Agent` and `Accept`, no cookie; a 10 s timer over headers and body; one retry on a network error or 5xx, none on a 4xx or a timeout; `text/html` and 403 are `blocked`; never throws; the body is never logged or audited. Limits for this source: `Accept: 'application/xml, text/xml'`; content types `['text/xml', 'application/xml']`; **byte cap 64 KB** (the file is about 1.8 KB; this leaves room for the ECB adding currencies, and stops anything page-sized). User-Agent: `AgentPilot-RateCheck/1.0 (admin-triggered exchange rate review; one request per click)`. This approval covers this URL for this feature only. The ECB's 90-day and historical files, Frankfurter and every other §5.7.2 source are **not** approved |
| SQ-36 | **Copy, do not lift.** Lifting the core would force edits to `fetchSources.source.test` (count 1 → 0, and its URL pin) and to a charging-adjacent, ratcheted module, in a slice that is otherwise read-only. A copy is about 100 lines, and it is the same reviewed shape. `ecbFeed.ts` copies `attempt` / `readCapped` / `discardBody` / the retry loop **as-is**. It keeps its own types (`EcbFetchResult` with the same outcome strings) and its own source guard (step 1e.1-9), and it imports **nothing** from `lib/ai/pricing-research/fetchSources.ts`. The file header names its origin ("copy of the price review's `fetchLimited`, SA §13.7 SQ-36") so a fix in one is looked for in the other. **Follow-up FU-1e-1:** when a third outbound consumer is proposed, lift both copies into one shared server-only helper in that slice, under its own SA review. `fetchSources.ts` and its tests stay **unedited** |
| SQ-37 | **ECB directly, XML, no dependency.** Frankfurter is rejected: it is a third party between us and the official source, it rounds to 5 significant digits, and it would need its own RR-8 approval anyway. There is no XML library, no `DOMParser` (absent on Node anyway), no `eval` and no `new Function`. The parser is a pure string reader with linear, anchored patterns (SA-1e-3). Without an XML parser there is no entity expansion, so no XXE or "billion laughs" risk exists; the byte cap bounds the input before any pattern runs |
| SQ-38 | **Accepted, amended: reuse `decimal.ts`, add only the division.** A new pure `lib/admin/exchangeRates/rateMath.ts` imports `parseDecimal`, `compareDecimals`, `subtractDecimals`, `absDecimal`, `signOfDecimal` and `type Decimal` from `@/lib/ai/pricing-research/decimal` (unedited; precedent `lib/repositories/types.ts`). It adds `divideHalfUp(numerator, denominator, places): Decimal`: align scales, scale the numerator by 10^(places+1), integer-divide, then round half **away from zero** on the magnitude, with the sign applied after. It also adds `toFixedPlaces(value, places): string` (exactly `places` digits, `-` for negatives, no `+`). **No `Number(`, `parseFloat`, `parseInt`, `Math.` or `toFixed` in `rateMath.ts`, `ecbRates.ts` or the sync route's arithmetic; no BigInt literal (`\d+n\b`): use `BigInt(…)` calls.** A source test pins all of this (step 1e.1-9). A zero denominator is never reached: `ecbRates` refuses a zero USD rate first (SA-1e-3); `rateMath` still throws on one, as a programming error |
| SQ-39 | **Accepted.** `POST /api/admin/exchange-rates/sync`, a new `app/api/admin/exchange-rates/sync/route.ts`. `requireAdmin` is the **first statement** (the `[currencyCode]` order, not `fetch-runs`'). Then the correlationId child logger; the body read as text (an empty body is `{}`, invalid JSON → 400); `z.object({}).strict()` → 400 `invalid_input` ("This action takes no input."). Then `listAll()` (an error → 500, **no fetch made**); fetch; parse; compute; audit; answer. A source failure is a **200** with `outcome` ≠ `ok` and no suggestions. 500 for the unexpected, in the standard error format with `details` only in development. `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 30` (two 10 s attempts plus margin). The path collision is checked above; the PATCH-on-`sync` 405 is accepted (SA-1e-6) |
| SQ-40 | **(a) Accepted: shown only, nothing stored.** No migration. The `EXCHANGE_RATE_SYNC_RUN` audit is the durable record of what the feed said; the accept is recorded by `EXCHANGE_RATE_UPDATED`. (b) needs a new requirement if the user asks |
| SQ-41 | **Accepted.** Gap = suggested − current. The absolute is `toFixedPlaces(…, 6)` with an explicit `+` when positive. The % is `divideHalfUp(gap × 100, current, 2)`, signed. **Direction and colour come from `compareDecimals(suggested, current)` on the exact values, never from the rounded %**, so a gap of `+0.000001` reads `+0.00%` but is still red. No tolerance band: the user's rule (BQ-2) is "no colour when equal", and a band would reopen it. "No change" exactly when `compareDecimals` is 0, which agrees with `sameRate` at 6 decimals |
| SQ-42 | **Allowed. This is the binding reading of D-5 and the CLAUDE.md row** ("An admin-maintained `exchange_rates` table exists, but no figure may be converted or summed with it"). The rule forbids applying a rate to an **amount of money**, and adding amounts in different currencies. Two operations are allowed: (i) deriving one rate from two rates of the same official feed (ECB(X) ÷ ECB(USD)), which yields a rate, not a converted figure; (ii) the difference between two rates **of the same currency**, absolute or as a % of one of them, which is a property of the rate. Neither takes an amount as input or produces one. Conditions: the sync payload and the page carry **no** amount, total, price or USD figure; the worked money example in §5.7.5 stays in this document and is never page copy; the new modules live under `lib/admin/exchangeRates/`, never `lib/business-os/**`; and `rateMath.ts` / `ecbRates.ts` headers record this ruling in one line, as `exchangeRateRules.ts` does ("a rate is only validated, compared with another rate, and shown"). Any future use of a rate on an amount still needs a user decision reversing D-5 |
| SQ-43 | **Accepted, optional and additive, on the `rate` branch only.** `origin: z.object({ kind: z.literal('sync'), source: z.literal('ecb'), rateDate: z.string().refine(isRealDate) }).strict().optional()`. When present, the audit `details` gain `origin` exactly as received. It is page-reported, and the server trusts it for the record only: it never changes validation, the value saved or the answer. The `enabled` branch is unchanged; `origin` there is a 400 |
| SQ-44 | **Accepted, optional, on the `rate` branch only.** `expectedRate: rateStringSchema.optional()`. Accept sends the `currentRate` the sync compared against. After the pre-read, `!sameRate(previous.rate_to_usd, expectedRate)` gives **409** `{ code: 'rate_changed', error: 'This rate changed since you synced. Sync again.' }`, with no write and no audit. Without `expectedRate`, behaviour is byte-for-byte today's (manual edits never send it). The sub-second gap between the pre-read and the update is accepted (one or two admins); a compare-and-set update would need a new repository method for no real benefit |
| SQ-45 | **No new tile, accepted.** The block is the existing rates table, which already has its KPIs ("Enabled currencies", "Last rate change"). A tile that is blank until a click would be a weak KPI, and it would move the `KpiStrip.callers.pin` hashes. TL shows the user this choice in one line at the diff review (the money-page KPI-first preference); it is not a blocker |
| SQ-46 | **Rejected as proposed: no server cache.** A module-level cache on Vercel lives per instance and per cold start, so two clicks can disagree on "cached". It adds state that Jest must reset between tests, and it saves nothing worth having: about 2 KB from a CDN that already sends `max-age=300`. The guard is page-side: the button is disabled while a sync runs. No 60 s refusal (there are no stored runs to measure, and the call is admin-only). Every answer is a fresh fetch with its own `fetchedAt` |
| SQ-47 | **Accepted.** `EXCHANGE_RATE_SYNC_RUN: 'EXCHANGE_RATE_SYNC_RUN'` beside the other two. Metadata: `severity: 'info'`, `complianceFlags: ['SOC2']`, `description: 'Public exchange rates read for review (nothing applied)'`. Audience `'shared'` (as its siblings). The pin moves `218 → 219` and `shared 74 → 75`, with the comment `// +1 shared (EXCHANGE_RATE_SYNC_RUN): Admin Exchange Rates slice 1e.1, SA §13.7 (2026-10-2x).` The entry: `entityType: 'exchange_rate'`, no `entityId`, `userId` / `actorId` = the admin, `request`. Its `details`: `{ source: 'ecb', outcome, rateDate \| null, durationMs, attempts, bytes, currencies: [{ currencyCode, currentRate, suggestedRate \| null, status }] }`. The list is bounded by the enabled currencies (at most 43). There is no body, no URL from the response and no anchor text beyond the anchor's name. It is written once for every POST that passes the admin gate and the body check (success and source failure alike), with `logAndFlush(…, { reason: 'exchange rate sync', continues: 'the suggestions are still shown' })`. An audit failure never fails the sync |
| SQ-48 | **Accepted.** The two columns render only after the first successful sync of the visit, so every existing table render test stays unedited. G-6 count `3 → 4` is a named forced edit with a comment line. `KpiStrip.callers.pin` is unchanged. The fixture holds no backslash (the PR #180 hazard) and is dated in its name |

#### Additional rulings

| # | Topic | Ruling |
|---|---|---|
| SA-1e-1 | A gap against an edited rate | The answer carries, per currency, the `currentRate` the server compared against. Suggestions survive a save and a re-read (FR-43), but a gap is only true for that base. The page therefore picks the cell state per row, by string comparison through `sameRate` (no arithmetic, no number parsing): **(1) Accepted:** the code is in the page's accepted set (1e.2, set on a successful Accept or Confirm and cleared by the next sync), **or** `!sameRate(s.currentRate, s.suggestedRate) && sameRate(row.rateToUsd, s.suggestedRate)` → "Accepted", with no button. **(2)** Else, if `sameRate(row.rateToUsd, s.currentRate)` → the gap as served (including "No change" for `direction: 'none'`), plus Accept or "Confirm (no change)" (1e.2). **(3)** Else → "Rate changed since the sync. Sync again.", with no gap colour and no button. FR-43 is read with this amendment. In 1e.1 the accepted set does not exist yet, and (1) only arises after a manual edit to the suggested value |
| SA-1e-2 | Where the button and state live | The fetch, the busy flag, the sync answer and the error live in `ExchangeRatesView` (the folder's only fetch owner). The button sits in the view's existing header actions, beside Refresh. `ExchangeRatesTable` stays presentational and gains one optional prop, `sync: RateSyncView \| null` (null → today's columns, exactly). The button is disabled while a sync runs, and while there is no successful plain read (no rows to place suggestions on). An answer that arrives after unmount is dropped (a mounted ref or an `AbortController`), as SA-1d-1 does for reads |
| SA-1e-3 | The parser (`ecbRates.ts`, pure) | `parseEcbDaily(text): { ok: true; rateDate: string; perEur: ReadonlyMap<string, string> } \| { ok: false; anchor: EcbAnchor }`. Anchors, each failure being `layout_changed` with its name. **E1:** `<gesmes:name>European Central Bank</gesmes:name>` present. **E2:** exactly one `<Cube\s+time=(['"])(\d{4}-\d{2}-\d{2})\1\s*>` and `isRealDate`. **E3:** every rate line matches `/<Cube\s+currency=(['"])([A-Z]{3})\1\s+rate=(['"])(\d{1,6}(?:\.\d{1,10})?)\3\s*\/>/g`, **and** the strict match count equals the loose `/<Cube\s+currency=/g` count, so a changed attribute order fails loudly instead of silently dropping a currency. **E4:** no code twice. **E5:** USD present with a non-zero rate. Each pattern is linear: no nested or adjacent unbounded quantifiers over the same characters, bounded digit runs, and it runs on input already capped at 64 KB. A per-currency rate of zero, or a derived rate that fails `RATE_PATTERN` / `isPositiveRate`, is that row's `no_usable_rate`, not a feed failure. `perUsdRates(perEur, codes)`: X ≠ EUR → `divideHalfUp(X, USD, 6)`; EUR → `divideHalfUp(1, USD, 6)`; USD itself is never requested; a code missing from the feed → `not_in_feed` (never 1, D-4) |
| SA-1e-4 | Wire types (`exchangeRateRules.ts`, pure) | `syncBodySchema = z.object({}).strict()`. `RateSyncOutcome = 'ok' \| 'timeout' \| 'network_error' \| 'blocked' \| 'layout_changed' \| 'too_large' \| \`http_${number}\``. `RateSuggestionStatus = 'suggested' \| 'not_in_feed' \| 'no_usable_rate'`. `GapDirection = 'up' \| 'down' \| 'none'`. `RateSuggestionWire { currencyCode; currentRate; status; suggestedRate: string \| null; gapAbsolute: string \| null; gapPercent: string \| null; direction: GapDirection \| null }`. `ExchangeRateSyncPayload { source: 'ECB'; outcome; rateDate: string \| null; fetchedAt; suggestions: RateSuggestionWire[] }`. Copy constants: `SYNC_OUTCOME_TEXT` (one plain sentence per outcome; `http_*` shares one sentence naming the status), and the §5.7.5 direction words. All strings are built on the server or in constants; the page prints them |
| SA-1e-5 | No URL on the page | G-6 bans `https?://` in `app/admin/exchange-rates/**`. The source shows as the text "ECB" (the attribution "Source: ECB" meets the ECB's reuse terms). No link to the ECB is shown, and the URL lives only in `ecbFeed.ts`. The fetch time is printed by slicing the ISO string (`HH:MM UTC`), not by locale formatting, so tests are deterministic |
| SA-1e-6 | `PATCH /api/admin/exchange-rates/sync` | It becomes 405 instead of 400 once `sync/route.ts` exists (static wins). Accepted; it needs no test edit. Dev confirms in the handover that no existing test sends it |
| SA-1e-7 | Skills and domains | Walk the `new-api-route` checklist for the sync route (and the PATCH in 1e.2): `requireAdmin` first, Zod before any read, correlationId, error format, `logAndFlush`. Not triggered: **no** entitlements import (type-only included), **no** LLM call (and none may read the feed, as RR-1), **no** cron or queue (D-9: a click), **no** caller-supplied tenant or id. The feed, the currency list and the rates all come from the server; the table is global with the documented rule 4 exemption. Schema facts are verified from `20261082` (above). Pino `createLogger({ module: 'AdminExchangeRatesSync' })` with a correlationId child, one line per sync: outcome, status, duration, attempts, bytes, currency count. The new files have 0 `console.*` |
| SA-1e-8 | Cycle | The step lists below are the workplan; deviations are recorded as DV-n in a short workplan MD that TL opens for QA. Under the user's exchange-rates fast-track, TL decides whether the user sees the diff. **SA recommends that the user sees the 1e.1 diff**: it is the platform's first outbound host outside the price review. That is a recommendation, not a gate |

#### Required changes

**BA (record edits; they do not gate Dev):** ✅ **Applied by BA 2026-10-25** (FR-43, §5.7.3, §5.7.5, §5.7.7, §5.7.8, §8 1e.1 / 1e.2, §12).
1. FR-43 and §5.7.7 "Held rows": add the SA-1e-1 rule (a gap is shown only while the row still holds the sync's base rate; otherwise "Rate changed since the sync. Sync again.").
2. §5.7.3: byte cap 64 KB, content types `text/xml` / `application/xml`, the route at `maxDuration = 30`, `requireAdmin` first. §5.7.8: no server cache, no refusal window (SQ-46).
3. §5.7.5 table: add the SA-1e-1 "Rate changed since the sync" row.
4. §8 1e.1: add the SA-1e-1 states, the E1-E5 anchor failures, the 64 KB cap and `PATCH …/sync` → 405. §8 1e.2: add the 409 `rate_changed` case and the audit `origin`.
5. §12: replace the "location per SQ-36 / SQ-38" row with the files named in the 1e.1 steps; the `fetchSources.ts` row becomes "Untouched (SQ-36: copied, not lifted)"; add `lib/audit/eventAudience.ts` and its test.

**Dev — slice 1e.1 (sync, Suggested rate, Gap; read-only):**

0. **Branch and baseline.** Use a branch from `origin/main` (this worktree's `feature/admin-exchange-rates-sync`, refreshed if `main` moved). Run the narrow Jest set (step 11) once before editing and record the counts.
1. **Fixture.** `lib/admin/exchangeRates/__fixtures__/ecb-eurofxref-daily-2026-10-23.xml`: the ECB file captured verbatim (with tabs). Its USD, GBP and ILS lines must read `1.1193`, `0.83728` and `3.4939`. Every malformed variant is built **inside the tests** by string replacement on this one file, not as more files.
2. **Rules, pure** (`lib/admin/exchangeRates/exchangeRateRules.ts`): the SA-1e-4 types, `syncBodySchema`, `SYNC_SOURCE_LABEL = 'ECB'`, `SYNC_OUTCOME_TEXT` and the direction words. Header: one line naming slice 1e.
3. **Rate math, pure** (`lib/admin/exchangeRates/rateMath.ts`, new) per SQ-38 and SQ-41: `divideHalfUp`, `toFixedPlaces`, and `rateGap(current, suggested): { gapAbsolute; gapPercent; direction }`. Its header records SQ-42.
4. **ECB parser, pure** (`lib/admin/exchangeRates/ecbRates.ts`, new) per SA-1e-3: `parseEcbDaily` and `perUsdRates`. Its header records SQ-42 and names the anchors.
5. **ECB fetch, server-only** (`lib/admin/exchangeRates/ecbFeed.ts`, new) per SQ-35 / SQ-36: `ECB_DAILY_URL`, `RATE_CHECK_USER_AGENT`, `ECB_SOURCE` (accept, content types, 64 KB), and `fetchEcbDaily(deps?: { fetchImpl?; now?; timeoutMs? }): Promise<EcbFetchResult>`, never throws. There is one source, so the route awaits it directly (no `allSettled` or `settledToResult`), inside the route's own `try`. It logs nothing.
6. **Route** (`app/api/admin/exchange-rates/sync/route.ts`, new) per SQ-39: the order in SQ-39, the enabled non-USD codes from `listAll()` (`isEnabled` true, `currencyCode !== BASE_CURRENCY`), `perUsdRates`, `rateGap` per suggested row, the SQ-47 audit, one Pino line, and the `ExchangeRateSyncPayload` answer. The header describes the shape, security (no input, one constant URL, body never logged), answers (200 / 400 / 401 / 403 / 500) and the SQ-42 note. It writes nothing: no repository write method is imported.
7. **Audit:** `lib/audit/events.ts` (const + metadata), `lib/audit/eventAudience.ts` (`'shared'`) and `lib/audit/__tests__/eventAudience.test.ts` (219 / 75, plus the comment line).
8. **Page.**
   - `ExchangeRatesView.tsx`: per SA-1e-2, one new literal `fetch('/api/admin/exchange-rates/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })`, read through `readAdminResponse`. Busy and `aria-busy` while it runs. Outcome text or the server's error by the button, in the same live region style as the existing notices. A status line after a successful sync: "Source: ECB · rates of {rateDate} · fetched {HH:MM} UTC". Update the header comment ("four `fetch(` call sites").
   - `ExchangeRatesTable.tsx`: the `sync` prop. When it is non-null, two columns after "Rate to USD": "Suggested rate" and "Gap". Cells per §5.7.5 plus SA-1e-1, through `StatusChip` with words and an icon (A-7). Words only for USD ("Base, always 1"), disabled ("Not synced (disabled)"), not in feed ("No public rate"), not usable ("No usable rate"), enabled after the sync ("Sync again to get a rate") and rate changed (SA-1e-1). No Accept in 1e.1.
9. **Source guard** (`lib/admin/exchangeRates/__tests__/rateSync.source.test.ts`, new), with the price review's guard as its model:
   - `fetch(` appears exactly once in `ecbFeed.ts`, and 0 times in `rateMath.ts`, `ecbRates.ts`, `exchangeRateRules.ts` and the sync route.
   - The only `'https://…'` literal across those files is `ECB_DAILY_URL` in `ecbFeed.ts`.
   - `ecbFeed.ts` has `import 'server-only'`; `rateMath.ts`, `ecbRates.ts` and `exchangeRateRules.ts` do not.
   - None of the files imports an AI provider, the provider factory, an SDK, `CurrencyService` or `lib/business-os/**`, and none imports from `pricing-research/fetchSources`.
   - `rateMath.ts`, `ecbRates.ts` and the route contain no `Number(`, `parseFloat`, `parseInt`, `Math.`, `toFixed(`, `eval(`, `new Function` or a BigInt literal.
   - No logger call in the route holds `.text`, `body` or `raw`.
   - The fixture holds no backslash and its name is dated.
   - A planted control for each rule (the rule can match).
10. **Tests.**
    - `rateMath.test.ts`: the three §5.7.2 values, including `3.121505` (the half-up case); a constructed exact tie at the 7th decimal both ways; a negative half away from zero; the gap worked case `3.09` / `3.70` → `+0.610000`, `+19.74%`, `up`; a lower suggestion → `-…`, `down`; equal (`3.090000` vs `3.09`) → `none`; a `+0.000001` gap → `+0.00%`, still `up`; a zero denominator throws.
    - `ecbRates.test.ts`: the fixture parses (rate date `2026-10-23`, USD / GBP / ILS strings verbatim); E1-E5 each fail with their own anchor (each by a string replacement); double-quoted attributes parse; a swapped attribute order fails E3 (not a silent drop); a zero GBP gives `no_usable_rate`; a code not in the feed gives `not_in_feed`; a result over `RATE_MAX` gives `no_usable_rate`.
    - `ecbFeed.test.ts` (injected `fetchImpl`, no network): ok; 301 → `http_301` and the redirect not followed; 403 → `blocked`; `text/html` → `blocked`; `application/json` → `layout_changed`; 500 then 200 → ok in 2 attempts; 500 twice → `http_500` in 2 attempts; 404 → one attempt; a network error then ok; a timeout (fake timers, no retry); a declared `content-length` over 64 KB → `too_large`, unread; a streamed body over 64 KB → `too_large`; the exact headers sent (`User-Agent`, `Accept` only), `redirect: 'manual'` and `cache: 'no-store'`; the URL is `ECB_DAILY_URL`.
    - `sync/__tests__/route.test.ts`: not admin → refused, `listAll` and `fetchImpl` never called; `{ url: … }`, `{ currencies: […] }` or `{ rate: … }` → 400, no read, no fetch; invalid JSON → 400; an empty body and `{}` → 200; happy path from the fixture with ILS / EUR / GBP enabled, USD enabled and JPY disabled → exactly three suggestions with the §5.7.2 values, `rateDate`, `fetchedAt` and `source: 'ECB'`; a feed failure → 200 with the outcome and no suggestions; `listAll` error → 500, no fetch; one `EXCHANGE_RATE_SYNC_RUN` per accepted POST with the SQ-47 shape, via `logAndFlush`; an audit failure → still 200; no repository write method exists on the mock or is called; the logger spy finds no fixture text.
    - Rates render suite, new `describe('slice 1e.1')`: before a sync the header row is exactly today's; button busy / disabled during a sync and disabled with no plain read; after a sync the two columns, the status line and every §5.7.5 row state appear; red / green / none each with words and an icon; each failure outcome shows its sentence and the table still edits; suggestions survive Refresh, a save and a Show change; after a manual edit, the row shows "Rate changed since the sync. Sync again." (SA-1e-1); unmount mid-sync → no state write; the POST body is `{}` and the URL is exact.
    - Forced edit: `redundantPages.source.guard` `toBe(3)` → `toBe(4)`, with the test name and comment naming the sync POST. **No other existing test is edited.**
11. **Checks.**
    - Narrow Jest over `lib/admin/exchangeRates`, `app/api/admin/exchange-rates`, `app/admin/exchange-rates`, `app/admin/finance`, `app/admin/__tests__`, `lib/audit/__tests__`, `lib/admin/__tests__/admin-authz-surface.guard.test.ts`, `lib/ai/pricing-research` (green, **unedited**), `lib/business-os/finance/__tests__/finance.source.guard.test.ts` and `lib/repositories/__tests__/adminReadMethods.guard.test.ts`.
    - `tsc` (narrow, your files), `eslint`, `lint:hooks`.
    - Before the handover, run `git diff --stat` (no file outside steps 1 to 10) and `git diff --numstat` (no deletion-only file). Confirm `fetchSources.ts`, `decimal.ts`, `CurrencyService.ts`, `package.json` and the lockfile are untouched, and that there is no migration.

**Dev — slice 1e.2 (Accept suggestion), from `origin/main` after 1e.1 merges:**

1. **Rules:** in `patchBodySchema`, the `rate` branch gains `expectedRate: rateStringSchema.optional()` (SQ-44) and `origin: rateOriginSchema.optional()` (SQ-43), with `.strict()` kept on both branches. Export `rateOriginSchema` and its type.
2. **PATCH route** (`[currencyCode]/route.ts`): after the pre-read and the 404, an `expectedRate` that is not `sameRate` with the stored value gives a 409 `rate_changed`, with no write and no audit. Audit `details` gain `origin` when present. Header: the two optional keys and the 409.
3. **Page:**
   - The table's Actions gain "Accept suggestion" only in SA-1e-1 state (2) with `status: 'suggested'`. The label is "Confirm (no change)" when `direction === 'none'`. The accessible name is "Accept suggested {CODE} rate {rate}".
   - The view's handler calls the **existing** `patch` with `{ field: 'rate', rate: s.suggestedRate, expectedRate: s.currentRate, origin: { kind: 'sync', source: 'ecb', rateDate } }`, then runs the same re-reads as `saveRate` (history and tile).
   - Busy per row. A refusal shows in the row's existing error slot (FR-9); a 409 shows the server's sentence.
   - After success the code joins the page's accepted set (SA-1e-1 state (1), "Accepted"); a new sync clears the set. No new `fetch(`: G-6 stays at 4.
4. **Tests:**
   - `exchangeRateRules.test.ts`: both new keys accepted on `rate`; refused on `enabled`; `origin` with an unknown key, a bad date, or `source: 'frankfurter'` → refused; existing cases unedited.
   - PATCH `route.test.ts`: `expectedRate` equal (including `3.09` vs `3.090000`) → 200; different → 409, `updateRate` not called, no audit; absent → today's behaviour (the existing cases unedited); `origin` reaches the audit details; `origin` on `enabled` → 400.
   - Render suite, `describe('slice 1e.2')`:
     - The button appears only in state (2) and never for USD, disabled, not-in-feed, not-usable or rate-changed rows.
     - The PATCH body is exact.
     - After success the row shows "Accepted", the Stale chip is gone and the history re-read runs.
     - "Confirm (no change)" shows for an equal suggestion.
     - A 409 shows the sentence and the stored rate stays.
     - There is no "Accept all" control (query by role and name).
5. **Checks:** as 1e.1 step 11. 1e.2 also runs the full `[currencyCode]` suite unedited apart from additions.


### D-10 (user decision, verbatim)

| # | Topic | Decision | Source (verbatim) | Consequence for this requirement |
|---|---|---|---|---|
| D-10 | Rate sync additions (**adds to D-9**; amends SA-1e-5, SQ-43, SQ-45 and the 1e split if SA agrees) | Four additions to slice 1e: (1) **say where the rates come from**, by the button or in a tooltip, ideally **with a link to the source's website**; (2) **an audit trail line for this activity, including each accepted rate**, so these actions can be tracked; (3) **a KPI tile with the date the rates were last checked**; (4) **fewer PRs**: the RM groups the commits as SA recommends, and the grouping is written in the workplan. **Dev may begin once these are in the plan** | "few more commends to add to plan: 1. indicate somewhere (maybe tool tip or text near it the location where we are taking the rates, maybe even link to their website). 2. add an audit trail line for this activity including for each accept rate activity, so we track these activities as well. 3. add a KPI box indicating last currency checked rates date once this is incorporated, dev can begin. i would like to reduce the amount of PRs, so have RM consolidate the commits based on SA's recommendation of the plan and what areas/tasks can be grouped together. indicate it on the workplan" (2026-10-25) | New §5.7.12; FR-50 to FR-55; §8 1e criteria; §12 rows; SQ-49 to SQ-52. (1) amends **SA-1e-5** (no link on the page): BA proposes the page URL as a constant outside the page folder (SQ-49). (2) the sync is already audited (`EXCHANGE_RATE_SYNC_RUN`); BA proposes a distinct `EXCHANGE_RATE_SUGGESTION_ACCEPTED` for each accept, instead of `EXCHANGE_RATE_UPDATED` + `origin` (SQ-50). (3) amends **SQ-45** (no new tile): a third tile, read from the newest successful sync audit entry, so no migration (SQ-51). (4) one PR for 1e instead of two (SQ-52). D-4, D-5 and D-9 unchanged: still nothing applied automatically, nothing converted |

### §13.8 SA review: D-10 additions (all of it)

### 13.8 SA review: D-10 additions

**Reviewed by SA — 2026-10-25.** This is a requirement review of the D-10 row, §5.7.12 A to D, FR-50 to FR-55, the §8 "D-10 additions" block, the §12 D-10 rows and SQ-49 to SQ-52. Code was read from `feature/admin-exchange-rates-sync` at `90e739be`. That is 2 commits behind `origin/main` (`7e51af5b`, #504: test-account cleanup migrations and scripts only, so no file overlaps 1e). The ECB human page was probed once.

**Verdict: CLEARED-WITH-CHANGES. Dev may begin from the step list below** (the user: "once this is incorporated, dev can begin"). The user's four points are not reopened. Each one is buildable with no migration, no new dependency and no new pattern. This review changes six things:
1. The sync contract moves to its own pure module, `rateSyncRules.ts` (SQ-52; it makes the commit plan work).
2. The column-header tooltip is replaced by visible text (SQ-49).
3. The accept entry's `details` keep the sibling event's key names (SQ-50).
4. `origin` requires `expectedRate` (SQ-50).
5. `lastSync` has three states, not `| null` (SQ-51).
6. "Never" becomes "No sync on record" (SQ-51).

**Verified against the code:**

| Claim | Result |
|---|---|
| G-6 ban (SQ-49) | ✅ `app/admin/__tests__/redundantPages.source.guard.test.ts:110-115`: `EXCHANGE_BANS` holds `['outside host', /https?:\/\//]`, run on comment-stripped code of every non-test file under `app/admin/exchange-rates/`. A page that imports a constant has no `https://` text, so it **passes**. The real "never contacts an outside host" guarantee is a different rule: `ALLOWED_FETCH` (`:128`) requires every `fetch(` first argument to be a **string literal** starting `/api/admin/exchange-rates`. So `fetch(ECB_SOURCE_PAGE_URL)`, or `fetch(` on any variable, is still a stray fetch and fails. `:237` pins `toBe(3)` |
| ECB human page (SQ-49) | ✅ `https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html` → **200** directly (no redirect), `text/html; charset=UTF-8`, probed 2026-10-25. It is the page, not the feed |
| New-tab link precedent | ✅ `target="_blank"` + `rel="noopener noreferrer"` in `app/admin/system-config/components/PriceRowCells.tsx:216-218`, `app/admin/users/components/BoostBlock.tsx:252-254` (with an `aria-hidden` `ExternalLink` icon), `PlanBillingBlock.tsx:256`, `PriceHistoryDrawerBody.tsx:82`. No new pattern |
| Tooltip primitive | ⚠️ The only accessible tooltip in admin is private to `KpiTile` (the MK-0 indicator). There is none for a table header. A `title=` attribute cannot be reached by keyboard. So a header tooltip would be a new pattern (CLAUDE.md rule 7) for text that the visible source line can carry |
| `EXCHANGE_RATE_UPDATED` readers (SQ-50) | ✅ Repo-wide grep (code, tests, `supabase/`): one writer (`[currencyCode]/route.ts:137`), the registry (`events.ts:398`, `:1206`), the audience map (`eventAudience.ts:141`) and the tests. **No reader counts it as "every rate change".** The "Last rate change" tile reads `exchange_rate_history` (trigger-written), so an accept that changes the rate still shows there |
| Audience pin (SQ-50) | ✅ `lib/audit/__tests__/eventAudience.test.ts:81-85`: 218 / bos 60 / shared 74 / agentspilot 84, the same on `origin/main`. With both 1e events: **220 / 60 / 76 / 84** |
| Audit Trail Action filter (FR-53) | ✅ `app/admin/audit-trail/__tests__/filterOptions.guard.test.ts` has **no count pin**. It forbids literal options and requires `buildActionFilterGroups({ audiences: OPERATOR_AUDIENCES })`. `lib/audit/__tests__/filterOptions.test.ts:37` derives its length from the registry. `classifyAuditEvent` falls back to the first token, so both events join the existing `EXCHANGE_*` group. **No edit to either file, and no change to the page** |
| "Confirm (no change)" | ✅ It goes through the same `PATCH`. The route already writes one audit entry when the value is unchanged (`unchanged` is computed at `:129`, and the entry is still written). With `origin`, it is the new event, with direction `none` |
| `listAdminPricingSyncRuns` precedent (SQ-51) | ✅ `AuditTrailRepository.ts:733-762`: refuses a missing context before any query; `.eq('action', AUDIT_EVENTS.…)`, `.order('created_at', desc)`, `.limit(cap)`; info log with counts only; warn on failure; returns `RepositoryResult`, never throws. The header (`:59-77`) documents it as the fifth admin exception. A `details->>key` filter has a precedent at `:786` (`hasFindingEntry`). A `->>` path in `.select` has one at `lib/business-os/insight/detectors/catalog/WebPageNoConversionsDetector.ts:206` |
| `adminReadMethods.guard` (SQ-51) | ⚠️ `lib/repositories/__tests__/adminReadMethods.guard.test.ts:486-506` `ADMIN_METHODS`; `:540-544` asserts **at least one caller** and none outside `app/api/admin/`. A new method must be added to that list, and **its caller must land in the same commit**, or the guard is red |
| Index on `audit_trail (action, created_at)` (SQ-51) | ⚠️ No composite index in the repo. `supabase/SQL Scripts/create_audit_trail.sql:40` `idx_audit_trail_action` (btree) and `:44` `idx_audit_trail_created_at` (DESC), created outside `migrations/`. `created_at` was confirmed live in [ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md](/docs/requirements/ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md) §700. The `action` index was not checked live by SA (read-only review). The read takes the few `EXCHANGE_RATE_SYNC_RUN` rows (one per click), filters `details->>outcome`, then takes the top one by `created_at`. `listAdminPricingSyncRuns` already runs this shape in production. **No index and no migration** |
| Plain `GET` (SQ-51) | ✅ `app/api/admin/exchange-rates/route.ts:236-240`: `listAll`, `listRecentHistory` and `findLatestChange` run in one `Promise.all`, and any failure is a 500 (the header's "Every read must succeed", SA R-3). The `?currency=` branch returns `ExchangeRateHistoryPayload` and never reaches that `Promise.all`. Its test asserts exact bodies at `__tests__/route.test.ts:173` and `:294`, so adding a key there is a forced edit |
| `KpiTile` "unavailable" | ✅ `KpiStrip.tsx:61` `KpiTileStatus` includes `'unavailable'` (label "Could not check", `:104-109`). `formatUtc` (`adminFormat.ts:21`) prints `YYYY-MM-DD HH:MM UTC` by slicing the ISO string, which is deterministic |
| `KpiStrip.callers.pin` | ✅ Five `ExchangeRatesKpis` cases (`:296-300`): loading, and four with a payload. A third tile re-hashes **all five**; no other caller's case moves (1c.1 precedent, `:37`) |
| Existing render suite | ⚠️ `exchangeRates.render.test.tsx:404-405` pins the tile list to exactly `['kpi-enabled-currencies', 'kpi-last-rate-change']`, so this is a forced edit. Mount-time call counts (`:193`, `:290`, `:601`) are **unaffected**, because the tile reads the plain `GET` and the page makes no new fetch on mount |
| Finance tab | ✅ `app/admin/finance/components/FinanceView.tsx:370` renders `<ExchangeRatesView />` with no props. 1e changes no prop and no file under `app/admin/finance/**` |
| `console.*` in touched files | ✅ 0 in `AuditTrailRepository.ts`, both rates routes, the four view components and `exchangeRateRules.ts` |

#### Rulings

| # | Ruling |
|---|---|
| SQ-49 | **Accepted, amended.** (1) **The link is a reasonable design, not a loophole, and G-6 stays unedited.** G-6's `https?://` ban is a text proxy for "the page never contacts an outside host". The binding rule is `ALLOWED_FETCH`, which still refuses any `fetch(` whose first argument is not a `/api/admin/exchange-rates` literal, so the imported constant cannot be fetched. When an admin clicks a link, the browser navigates to the page; the page itself contacts no outside host. **No allow-list in G-6:** an allow-list would let `https://` text into the folder, which is weaker than today. (2) **Location:** `ECB_SOURCE_LABEL = 'European Central Bank (euro foreign exchange reference rates)'`, `ECB_SOURCE_PAGE_URL` (the BA's URL, verified above) and `ECB_SOURCE_NOTE = 'Published by the ECB for information only.'` live in the **new** pure `lib/admin/exchangeRates/rateSyncRules.ts` (SQ-52), not in `exchangeRateRules.ts`. (3) **`rateSync.source.test`:** exactly **two** `https://` literals across `lib/admin/exchangeRates/**` non-test files: `ECB_DAILY_URL` in `ecbFeed.ts` and `ECB_SOURCE_PAGE_URL` in `rateSyncRules.ts`, each pinned to its exact value. Zero in `exchangeRateRules.ts`. In `app/admin/exchange-rates/**`, `ECB_SOURCE_PAGE_URL` appears **once**, as `href={ECB_SOURCE_PAGE_URL}`. Neither `ECB_DAILY_URL` nor `ecbFeed` is imported anywhere under `app/admin/`. Each rule has a planted control. The file header cites this ruling, so G-6's silence on links is on record. (4) **What the admin sees:** one always-visible line beside Sync rates: "Source: " + the label as a link, then `ECB_SOURCE_NOTE`. The link has `target="_blank"`, `rel="noopener noreferrer"`, an `aria-hidden` `ExternalLink` icon and an `sr-only` " (opens in a new tab)" (BoostBlock precedent). **No header tooltip** (FR-50 amended): the user asked for "tool tip or text near it", text near it meets that, and a header tooltip would be a new pattern for the same words. The per-cell "ECB · rates of … · fetched … UTC" line is unchanged |
| SQ-50 | **(a) Accepted, amended.** `EXCHANGE_RATE_SUGGESTION_ACCEPTED`: `severity: 'info'`, `complianceFlags: ['SOC2']`, `description: 'Suggested exchange rate accepted by an admin'`, audience `'shared'`. The `PATCH` writes it **instead of** `EXCHANGE_RATE_UPDATED` when the `rate` save carries `origin`: one save, one entry. A manual edit, a 400, a 404 and a 409 are unchanged (no new entry). **Amendments:** (1) **`details` is a superset of the sibling's shape**, so anything that reads rate changes reads both events the same way: `{ currencyCode, field: 'rate', oldValue, newValue, unchanged, origin: { kind, source, rateDate }, gap: { gapAbsolute, gapPercent, direction } }`. The BA's `oldRate` is `oldValue` (the pre-read, as today), and `suggestedRate` is `newValue` (the **stored** value, not the page's string). `gap` is `rateGap(oldValue, newValue)` on the server; nothing in it comes from the page. `origin` is page-reported and kept for the record only (SQ-43). (2) **`origin` requires `expectedRate`:** on the `rate` branch, a `.superRefine` makes `origin` without `expectedRate` a 400. Then every accept entry was checked against the rate the sync compared (SQ-44), and an accept can never be recorded against a base that had changed. (3) "Confirm (no change)" uses the same event (`unchanged: true`, direction `none`). (4) The pin becomes **220 / bos 60 / shared 76 / agentspilot 84**, with one comment line: `// +2 shared (EXCHANGE_RATE_SYNC_RUN, EXCHANGE_RATE_SUGGESTION_ACCEPTED): Admin Exchange Rates slice 1e, SA §13.7 SQ-47 / §13.8 SQ-50 (2026-10-2x).` (5) `filterOptions.guard.test.ts` and `filterOptions.test.ts` are **not edited** (verified above) |
| SQ-51 | **Accepted, amended: read the audit, no migration, no index.** (1) **Repository:** `AuditTrailRepository.findLatestAdminExchangeRateSync(context: AdminAuditReadContext): Promise<RepositoryResult<AdminExchangeRateSyncRun \| null>>`. It refuses a missing context before any query. The query is `.from('audit_trail').select(ADMIN_EXCHANGE_RATE_SYNC_COLUMNS)` with `ADMIN_EXCHANGE_RATE_SYNC_COLUMNS = 'created_at, rate_date:details->>rateDate'` (exported, no `details` blob, no actor, no ip), then `.eq('action', AUDIT_EVENTS.EXCHANGE_RATE_SYNC_RUN)`, `.eq('entity_type', 'exchange_rate')`, `.eq('details->>outcome', 'ok')`, `.order('created_at', { ascending: false })`, `.limit(1)`. A `rate_date` that fails `isRealDate` is an error, not a row. It logs info with `rows` only, and warns on failure. The header gets "THE SIXTH ADMIN EXCEPTION": not `user_id`-scoped, because it is a platform event whose user id is the acting admin. Live audit only. Its only caller is the plain `GET`. Add the name to `ADMIN_METHODS`, with a comment line. (2) **Index:** none needed (see the table). If the read is ever slow, the tile goes `unavailable` and the page still works. (3) **The `GET`:** the read is the **fourth member of the existing `Promise.all`**, so it adds no latency. It is wrapped in a local `settleLastSync()` that turns a returned error **or a throw** into `{ status: 'unavailable' }` and logs `warn` with `failed: 'lastSync'`. It **never** gives a 500; the header records this as the one exception to "every read must succeed". The `?currency=` read never calls it, and a test pins that. (4) **Wire, three states**, which `\| null` cannot express (the BA's own FR-55 needs "unavailable"): `LastRateSyncWire = { status: 'ok'; checkedAt: string; rateDate: string } \| { status: 'none' } \| { status: 'unavailable' }`. The `GET` answer type is `ExchangeRatesReadPayload = ExchangeRatesPayload & { lastSync: LastRateSyncWire }`, both in `rateSyncRules.ts`. `ExchangeRatesPayload` itself is unchanged (SQ-52). (5) **What feeds the tile:** after a successful sync, the **sync answer** feeds it. No re-`GET`, and no new field on the sync answer: a pure `lastSyncFromSync(answer)` gives `{ status: 'ok', checkedAt: fetchedAt, rateDate }` when `outcome === 'ok'`, else `null`. The view keeps the visit's value and shows it ahead of the `GET`'s, so a later re-read cannot move the tile back even if that sync's audit flush failed. A failed sync leaves the tile unchanged. (6) **Tile:** `testId="kpi-rates-last-checked"`, label "Rates last checked", value `formatUtc(checkedAt)`, sub "ECB rates of {rateDate}". For `none`: "No sync on record", because audit archiving can remove an old entry and "Never" would then be false. For `unavailable`: `status="unavailable"` (the existing "Could not check"), no value, sub "The audit trail could not be read". It goes after the two existing tiles, which are unchanged, and the loading strip shows 3 placeholders. `ExchangeRatesKpis` gains a required prop `lastSync: LastRateSyncWire` (the view passes the visit's value or the `GET`'s). (7) **`KpiStrip.callers.pin`:** the five Exchange rates cases are re-hashed: loading has 3 placeholders, and the four payload cases gain `lastSync` ok. Two cases are appended (`none`, `unavailable`). A dated amendment line is added. No other hash moves. **SQ-48's "unchanged" is superseded** |
| SQ-52 | **Accepted: one branch, one PR, seven commits** (plan below). (1) **New module `lib/admin/exchangeRates/rateSyncRules.ts`** (pure, no `server-only`, imported by the page) holds the whole sync contract: the SA-1e-4 types and `syncBodySchema`, `SYNC_SOURCE_LABEL`, `SYNC_OUTCOME_TEXT`, the direction words, the three ECB source constants, `LastRateSyncWire`, `ExchangeRatesReadPayload` and `lastSyncFromSync`. It imports only from `exchangeRateRules.ts` (existing exports and the type `ExchangeRatesPayload`), never the other way round, so there is no import cycle. **Why:** `exchangeRateRules.ts` would otherwise be edited for three unrelated reasons (sync types, the `GET` payload, the `PATCH` schema), and the RM cannot split one file across commits. Interactive staging (`git add -p`) is not available, and hand-built partial files carry the known agent file-write truncation hazard. It also keeps the 346-line rules module about stored rates. **`exchangeRateRules.ts` now changes for the `PATCH` alone** (`expectedRate`, `rateOriginSchema`, the `superRefine`). (2) **Commits are file-disjoint**: every changed file belongs to exactly one commit. (3) **Each commit must be green on its own: required, not just recommended.** "Green" means the narrow Jest set for its paths plus the cross-cutting guards, and narrow `tsc` on its files and their importers. The PR merges with a merge commit, so its commits land on `main` and a red one would mislead a later `git bisect`. The plan below is built so this holds; the type coupling (ts-jest type-checks every test) was traced file by file. (4) The RM writes the plan into the workplan before the first commit. The **workplan is renamed** `docs/workplans/ADMIN_EXCHANGE_RATES_SLICE_1E_WORKPLAN.md` (TL or Dev; one file for the whole slice) |

#### Marks on §13.7 (amended by D-10)

| §13.7 item | Status |
|---|---|
| Verdict line: "no new repository method" | **Amended by SQ-51:** one new admin read method, `AuditTrailRepository.findLatestAdminExchangeRateSync`. The repository row ("No new method, so `adminReadMethods.guard` is unaffected") is superseded: the guard gains one name |
| "Split confirmed: 1e.1, then 1e.2, each from `origin/main`, not stacked" | **Superseded by SQ-52:** one branch, one PR, seven commits. 1e.1 and 1e.2 remain build steps |
| SQ-43 (`origin` in `EXCHANGE_RATE_UPDATED` details) | **Amended by SQ-50:** `origin` is recorded in `EXCHANGE_RATE_SUGGESTION_ACCEPTED`, and `origin` now requires `expectedRate`. The schema itself stands. `exchangeRateRules.ts` owns `rateOriginSchema` |
| SQ-45 (no new tile) | **Superseded by the user (D-10 point 3) and SQ-51:** a third tile, "Rates last checked". TL's one-line "KPI-first" note at the diff review is no longer needed |
| SQ-48 ("`KpiStrip.callers.pin` is unchanged") | **Superseded by SQ-51 (7).** The rest of SQ-48 stands (columns only after the first sync; G-6 3 → 4; fixture rules) |
| SA-1e-4 (wire types in `exchangeRateRules.ts`) | **Amended by SQ-52:** the same types, in `rateSyncRules.ts` |
| SA-1e-5 (no URL on the page) | **Amended by SQ-49:** a link to the ECB's human page, through the `rateSyncRules.ts` constant. The page still holds no `https://` text and never fetches outside. The UTC slicing rule stands |
| SA-1e-8 (cycle; user sees the 1e.1 diff, recommended) | **Amended:** see "Reviews and the user's diff" below |
| §13.7 step lists | **Superseded by the step list below**, which refers back to §13.7 for detail that has not changed |

#### Commit plan (RM; recorded in the workplan before the first commit)

The order is the dependency order. Each commit is file-disjoint and green on its own.

| # | Conventional Commit | Files (and only these) | Depends on | Green on its own because |
|---|---|---|---|---|
| C1 | `feat(audit): register the exchange rate sync and accepted-suggestion events` | `lib/audit/events.ts`, `lib/audit/eventAudience.ts`, `lib/audit/__tests__/eventAudience.test.ts` | — | Registry and audience change together; pin 220 / 76; no reader yet |
| C2 | `feat(admin): ECB rate parser, rate maths and the sync contract` | `lib/admin/exchangeRates/rateSyncRules.ts`, `rateMath.ts`, `ecbRates.ts`, the dated fixture, and their tests (`rateSyncRules.test.ts`, `rateMath.test.ts`, `ecbRates.test.ts`) | — | New pure files only; `ecbRates` takes its status types from `rateSyncRules` (same commit) and existing exports from `exchangeRateRules` |
| C3 | `feat(admin): exchange rate sync route reading the ECB daily feed` | `lib/admin/exchangeRates/ecbFeed.ts` (+ `ecbFeed.test.ts`), `app/api/admin/exchange-rates/sync/route.ts` (+ `sync/__tests__/route.test.ts`), `lib/admin/exchangeRates/__tests__/rateSync.source.test.ts` | C1, C2 | New files; the source guard scans C2 and C3 files only; `admin-authz-surface.guard` sees `requireAdmin` first. The RR-8 surface sits in one commit for review |
| C4 | `feat(admin): rates last checked, read from the sync audit` | `lib/repositories/AuditTrailRepository.ts` (+ its new unit test file), `lib/repositories/__tests__/adminReadMethods.guard.test.ts`, `app/api/admin/exchange-rates/route.ts` (+ `__tests__/route.test.ts`) | C1, C2 | The method and its only caller land together (the guard needs at least one caller); the `GET` answer is `ExchangeRatesReadPayload`, so no existing `ExchangeRatesPayload` fixture changes |
| C5 | `feat(admin): accept a suggested rate with a stale check and its own audit entry` | `lib/admin/exchangeRates/exchangeRateRules.ts` (+ `exchangeRateRules.test.ts`), `app/api/admin/exchange-rates/[currencyCode]/route.ts` (+ `__tests__/route.test.ts`) | C1, C2 | The schema keys and the route that honours them land together; the page sends nothing new yet; tests are additions only |
| C6 | `feat(admin): sync rates, suggestions, gap, accept and last-checked tile on the rates page` | `app/admin/exchange-rates/components/ExchangeRatesView.tsx`, `ExchangeRatesTable.tsx`, `ExchangeRatesKpis.tsx`, `app/admin/exchange-rates/__tests__/exchangeRates.render.test.tsx`, `app/admin/__tests__/redundantPages.source.guard.test.ts`, `app/admin/components/layout/__tests__/KpiStrip.callers.pin.render.test.tsx` | C2 to C5 | All page files and every pin that sees the page move together (G-6 3 → 4, tile list, pin re-hash). The 1e.1 and 1e.2 UI ship as one commit because they share the same three components |
| C7 | `docs(admin): exchange rates slice 1e requirement, SA reviews and workplan` | `docs/requirements/ADMIN_EXCHANGE_RATES_REQUIREMENT.md`, `docs/workplans/ADMIN_EXCHANGE_RATES_SLICE_1E_WORKPLAN.md` | — | Docs only (no backslash-hex text, the Tailwind scan hazard) |

**How the RM proves "green on its own"** (no stash, no interactive rebase, no worktree removal):
1. Create C1 to C7 by staging each commit's exact file list.
2. With a clean tree, for each commit run `git checkout --detach <sha>`, then that commit's narrow Jest and narrow `tsc`. The commands go in the workplan.
3. Return with `git checkout feature/admin-exchange-rates-sync`.

If a commit fails, stop before the push and send it back to Dev. The commits may then be rebuilt with `git reset --soft <base>` and restaged; nothing has been pushed at that point. Before the first commit, run `git diff --stat`: every changed file must appear in exactly one row above, and the RM must stop on any file that does not. The results go in the PR body.

#### Updated Dev step list (whole slice 1e: 1e.1 + 1e.2 + D-10; one branch)

Detail not restated here is as in §13.7's lists. Each step is tagged with its commit.

0. **Branch and baseline.** In this worktree, run `git merge --ff-only origin/main` (the 2 new commits touch no 1e file; uncommitted docs survive a fast-forward; **no stash**). Rename the workplan to `ADMIN_EXCHANGE_RATES_SLICE_1E_WORKPLAN.md` and extend it to the whole slice: this list, the commit plan and the D-10 tests. Run the narrow Jest set (step 14) once and record the counts.
1. **[C1] Audit registry.** `EXCHANGE_RATE_SYNC_RUN` (SQ-47) and `EXCHANGE_RATE_SUGGESTION_ACCEPTED` (SQ-50) in `events.ts` (const and metadata) and `eventAudience.ts` (`'shared'`). The pin becomes 220 / 60 / 76 / 84, with the one comment line from SQ-50.
2. **[C2] Fixture.** As §13.7 1e.1 step 1.
3. **[C2] Sync contract, pure** (`rateSyncRules.ts`, new): SA-1e-4 types and `syncBodySchema`, `SYNC_SOURCE_LABEL = 'ECB'`, `SYNC_OUTCOME_TEXT`, the direction words, `ECB_SOURCE_LABEL`, `ECB_SOURCE_PAGE_URL`, `ECB_SOURCE_NOTE`, `LastRateSyncWire`, `ExchangeRatesReadPayload` and `lastSyncFromSync`. Its header names slice 1e, SQ-42, SQ-49 and SQ-52. Tests: the body schema refuses any key; `lastSyncFromSync` returns ok only when the outcome is `ok`, and `null` for every other outcome; the constants have their exact values.
4. **[C2] Rate maths** (`rateMath.ts`): as §13.7 1e.1 step 3, with its tests.
5. **[C2] ECB parser** (`ecbRates.ts`): as §13.7 1e.1 step 4, statuses typed from `rateSyncRules.ts`, with its tests.
6. **[C3] ECB fetch** (`ecbFeed.ts`): as §13.7 1e.1 step 5 (SQ-35 / SQ-36), with its tests.
7. **[C3] Sync route** (`sync/route.ts`): as §13.7 1e.1 step 6 (SQ-39, SQ-47), types from `rateSyncRules.ts`, with its route tests (§13.7 1e.1 step 10).
8. **[C3] Source guard** (`rateSync.source.test.ts`): as §13.7 1e.1 step 9, with the SQ-49 (3) amendments: two pinned `https://` literals; the `href`-only rule; neither the feed URL nor `ecbFeed` imported under `app/admin/`. `rateSyncRules.ts` joins the scanned, non-`server-only` files. Each rule has a planted control.
9. **[C4] Repository read.** `findLatestAdminExchangeRateSync` and `ADMIN_EXCHANGE_RATE_SYNC_COLUMNS` per SQ-51 (1), with the header's sixth-exception paragraph. New unit test, `lib/repositories/__tests__/AuditTrailRepository.latestExchangeRateSync.test.ts`, with a recording client (`adminReadMethods.guard` precedent). It covers: no context → error and no query; the exact select, filters, order and limit; no row → `null`; a row → mapped; a bad `rate_date` → error; a query error → error, warn logged, nothing thrown. `adminReadMethods.guard.test.ts`: the name goes into `ADMIN_METHODS` and the header list.
10. **[C4] Plain `GET`.** The fourth `Promise.all` member through `settleLastSync()` (SQ-51 (3)); the answer typed `ExchangeRatesReadPayload`; the header line for the exception. Route test forced edits: a `jest.mock` of `AuditTrailRepository`, and `lastSync` in the two exact bodies (`:173`, `:294`). New cases: ok, none, a returned error → `unavailable` with 200 and the rest intact, a throw → the same, and `?currency=` never calls the read.
11. **[C5] `PATCH` rules.** In `exchangeRateRules.ts`, `rateOriginSchema` and, on the `rate` branch only, `expectedRate` and `origin` (SQ-43, SQ-44), plus the `superRefine` that makes `origin` without `expectedRate` a 400 (SQ-50 (2)). `.strict()` stays on both branches. Tests are additions only (§13.7 1e.2 step 4, plus "`origin` alone → refused").
12. **[C5] `PATCH` route.** The 409 `rate_changed` (SQ-44). With `origin` → `EXCHANGE_RATE_SUGGESTION_ACCEPTED` with the SQ-50 (1) `details` (`gap` from `rateGap(oldValue, newValue)`). Without it → today's `EXCHANGE_RATE_UPDATED`, byte for byte. The header documents the keys, the 409 and the two events. Tests are additions: an accept writes exactly one new-event entry and no `EXCHANGE_RATE_UPDATED`; the worked gap (`3.09` → `3.121505` → `+0.031505`, `+1.02%`, `up`); a confirm → `unchanged: true`, `none`; a 409 or 400 → no entry; a manual edit → the old event, `details` unchanged.
13. **[C6] Page.**
    - `ExchangeRatesView`: as §13.7 1e.1 step 8 and 1e.2 step 3. One new literal `fetch(` (the sync POST). The source line per SQ-49 (4). The visit's `lastSync` from `lastSyncFromSync` (SQ-51 (5)), passed to `ExchangeRatesKpis` ahead of the `GET`'s. The Accept handler sends `expectedRate` and `origin`. The accepted set.
    - `ExchangeRatesTable`: the `sync` prop, the columns, every §5.7.5 and SA-1e-1 state, and Accept / "Confirm (no change)".
    - `ExchangeRatesKpis`: the third tile per SQ-51 (6), and the header comment updated.
    - Forced test edits: G-6 `toBe(3)` → `toBe(4)`, with the name and comment naming the sync POST; `exchangeRates.render.test.tsx`, where the `payload()` fixture gains `lastSync` and the tile list at `:405` gains `'kpi-rates-last-checked'`; `KpiStrip.callers.pin` per SQ-51 (7).
    - New render cases: the §13.7 1e.1 and 1e.2 describes, plus D-10. D-10 covers: the source line before and after a sync, with the link's `href`, `target`, `rel` and accessible name; the tile in ok, none and unavailable; the tile updated from the sync answer with no extra `GET`; a failed sync leaving the tile as it was; a later re-read not moving the tile back.
    - **No other existing test is edited.**
14. **Checks.**
    - Narrow Jest: the §13.7 1e.1 step 11 set, plus `lib/repositories/__tests__` (the new file and `adminReadMethods.guard`), `app/admin/components/layout/__tests__/KpiStrip.callers.pin.render.test.tsx`, `app/admin/audit-trail/__tests__/filterOptions.guard.test.ts` and `lib/audit/__tests__/filterOptions.test.ts`. The last two must be green and **unedited**.
    - Also `tsc` (narrow), `eslint` and `lint:hooks`.
    - `git diff --stat` and `git diff --numstat`: every file maps to exactly one commit row, and no file shows deletions only. `fetchSources.ts`, `decimal.ts`, `CurrencyService.ts`, `app/admin/finance/**`, `app/admin/audit-trail/**`, `lib/business-os/**`, `package.json` and the lockfile are untouched, and there is no migration.
    - Record each deviation as DV-n in the workplan.

#### Reviews and the user's diff

- **One combined SA code review replaces the two.** It covers the whole working-tree diff before anything is committed, walked commit group by commit group in the plan's order, in one report in the workplan. C3 (the RR-8 outbound surface; the `new-api-route` checklist) and C5 (the `PATCH` change) get the line-by-line pass. C4 gets the admin-exception check. **One QA pass** covers the whole slice.
- **SA-1e-8 now covers the whole PR, and it is a gate, not a recommendation.** The user asked to see the diff and click through it before any commit. That instruction outranks the exchange-rates fast-track for this slice. The order is: Dev → SA code review → the user sees the full diff and clicks through (local dev) → QA → user approval → RM commits C1 to C7, proves each green, opens the PR. Once the PR is open, CI is the only remaining gate, so auto-merge with `--merge` is the TL's call under the standing preference.
- **The click-through list** (TL hands it to the user):
  - Sync rates, then the three suggestions and their gap colours.
  - The source link opens the ECB page in a new tab.
  - Accept one rate and Confirm another.
  - The tile updates after the sync and is still there after a reload.
  - The Audit Trail page's Action filter finds both new events.
  - The live sync makes one ECB request per click from local dev, which is allowed (SQ-35).

#### Domain checks (unchanged by D-10)

- **No entitlements import**, type-only included; nothing to register.
- **No LLM call.**
- **No cron or queue.**
- **No caller-supplied tenant or id.** The new audit read is an unscoped platform-event read with a documented exception and one admin-only caller. `origin` is page-reported and kept for the record only.
- **Schema:** no new column or table. `audit_trail.details` and `created_at` are already read by sibling methods.
- **Untouched:** `app/admin/finance/**`, `lib/business-os/**` and `finance.source.guard`.
- **Admin gate:** `requireAdmin` is the first statement in every handler 1e touches.

#### BA record edits (do not gate Dev)

1. **FR-50:** drop the header tooltip; the source line carries `ECB_SOURCE_NOTE`.
2. **FR-51:** the constants live in `rateSyncRules.ts`.
3. **FR-52 and §8 "Accept audit":** the SQ-50 (1) keys (`oldValue` / `newValue` / `unchanged` / `origin` / `gap`), and "`origin` requires `expectedRate`".
4. **FR-54:** the `formatUtc` value plus "ECB rates of {rateDate}", and "No sync on record".
5. **FR-55:** "unavailable" uses the tile's existing "Could not check" status.
6. **§5.7.12 A to D, §5.7.10 and §12:** add a `rateSyncRules.ts` row; the `exchangeRateRules.ts` row becomes `PATCH` keys only; add the forced edits to `exchangeRates.render.test.tsx`, the plain-`GET` route test and `adminReadMethods.guard`; mark `filterOptions.guard` and `filterOptions.test` as untouched.
7. **§1 row 1e:** "SA §13.8 CLEARED-WITH-CHANGES; Dev may begin".


---

## SA Review Notes

_SA populates this section: one combined code review of the whole working-tree diff, walked commit group by commit group (§13.8 "Reviews and the user's diff")._

### SA code review

**Code Review by SA — 2026-10-25**
**Status:** 🔄 Fix Required (one finding, F-1, in C2 files only). Verdict: **APPROVED-WITH-CHANGES**.

**What SA read and ran:**
- Source: the uncommitted working tree of `feature/admin-exchange-rates-sync` at `7e51af5b`, through `git status`, `git diff` and every new file, checked against §13.7 and §13.8.
- Tests, run again by SA: **80 suites, 4,050 tests, all green.** That covers the slice suites and these guards: G-6, KpiStrip, audience, admin-authz, adminReadMethods, filterOptions, finance, plus the `fetchSources` suites.
- Untouched list: clean. `git status` shows no change to `lib/ai/**`, `CurrencyService.ts`, `package.json`, the lockfile, `app/admin/finance/**`, `app/admin/audit-trail/**`, `lib/business-os/**`, `supabase/**` or `ExchangeRatesRepository.ts`.
- Logging: no `console.*` in any touched or new source.

**Condition:**
1. Dev fixes F-1. It touches only `ecbRates.ts` and `ecbRates.test.ts`, both in C2.
2. SA checks that diff alone. Nothing else is reviewed again.
3. Then the §13.8 order continues: the user's diff and click-through, then QA, then RM.

#### By commit group

| # | Group | Result |
|---|---|---|
| C1 | Audit registry | ✅ Both constants and their metadata match SQ-47 and SQ-50 exactly (`info`, `SOC2`). Both are `'shared'`. The pin is **220 / 60 / 76 / 84**, with the SQ-50 comment line dated 2026-10-25 (DV-12). `filterOptions.guard` and `filterOptions.test` are unedited and green |
| C2 | Contract, maths, parser, fixture | ✅ except **F-1**. `rateSyncRules.ts` is pure and imports only a type from `exchangeRateRules.ts`, so there is no cycle. It has the SQ-49 constants and values, a strict `syncBodySchema`, and `lastSyncFromSync`, which returns ok only when the outcome is ok. `rateMath.ts` imports exactly the SQ-38 list. It has no float, no `Math.` and no BigInt literal (`BigInt(…)` only). `divideHalfUp` keeps one extra digit, adds 5 and integer-divides by 10, so it rounds half away from zero exactly. The direction comes from `compareDecimals`, never from the rounded %. The worked values are pinned and green: ILS **3.121505**, GBP **0.748039**, EUR **0.893416**; 3.09 → 3.70 gives **+19.74%**; 3.09 → 3.121505 gives **+0.031505 / +1.02% / up**. The fixture is tab-indented, holds no backslash and has a dated name. `ecbRates.ts` imports `isRealDate` from `app/admin/components/adminWindowPresets`. That follows the precedent in `exchangeRateRules.ts`, and the module is documented as pure and isomorphic |
| C3 | Feed and sync route (RR-8 surface, line by line) | ✅ **`ecbFeed.ts`.** `attempt`, `readCapped`, `discardBody` and the retry loop match `fetchSources.ts:147-230` line for line, apart from the types, the user agent and the source. Nothing is imported from that file, and `server-only` is present. It fetches one constant URL with `redirect: 'manual'` and `cache: 'no-store'`, sending only `User-Agent` and `Accept`. The 10 s timer covers the headers and the body: it is cleared in `finally`, after `readCapped`. The 64 KB cap is checked from `content-length` and again while streaming. The content-type allow-list is `text/xml` / `application/xml`; `text/html` and a 403 are `blocked`. It retries once, and only on a network error or a 5xx. It never throws and logs nothing. **Route.** `requireAdmin` is the first statement, then the correlationId child of `AdminExchangeRatesSync`. The body is read as text: an empty body is `{}`, and bad JSON gets the same 400 as the strict schema (DV-9). A `listAll()` error is a 500, and no fetch is made. Only enabled non-USD rows are synced. No write method is imported. The audit goes through `logAndFlush` with the SQ-47 `details`, reason and continues text. A source failure is a 200. There is one Pino line, holding counts, the outcome and the anchor, never the body. The error format shows `details` in development only. `runtime`, `dynamic` and `maxDuration = 30` are set. **Tests.** Neither suite reaches the network: `forbidRealNetwork()` guards the feed suite, and the route suite stubs `global.fetch` to throw on any URL other than `ECB_DAILY_URL`. The source guard has a planted control for every rule and pins exactly two full URL literals |
| C4 | Audit read and the GET (admin-exception check) | ✅ `findLatestAdminExchangeRateSync` follows `listAdminPricingSyncRuns`. It refuses a missing context before any query. It selects exactly the time and the rate-date JSON path, with no `details` blob. It filters on action, entity type and outcome ok, orders by `created_at` desc and limits to 1. A bad rate date is an error. The info log carries `rows` only, a failure logs a warn, and it never throws. The header carries the sixth-exception paragraph. The `ADMIN_METHODS` entry and its only caller land in the same commit. The GET's `settleLastSync()` is the fourth `Promise.all` member and maps a returned error or a throw to `unavailable` (warn, `failed: 'lastSync'`), never a 500. Two tests pin that the `?currency=` branch never calls it |
| C5 | PATCH (line by line) | ✅ The union keeps `.strict()` on both branches. `expectedRate` and `origin` exist on the `rate` branch only, and `rateOriginSchema` is strict. The `superRefine` makes `origin` without `expectedRate` a 400. `patchBodySchema` has one caller, which uses `.safeParse`, so the `ZodEffects` wrapper breaks nothing. The order is: the USD 400, the pre-read 404, then the **409 `rate_changed`**, all before any write or audit. `EXCHANGE_RATE_SUGGESTION_ACCEPTED` replaces `EXCHANGE_RATE_UPDATED` **only** when `origin` is present. Its `gap` is `rateGap(previous.rate_to_usd, updated.rate_to_usd)`, computed from both stored values. That call is wrapped, so if the gap ever fails the entry records null and the saved change stands. A manual edit's `details` are unchanged (`route.test.ts:554-558`). `expectedRate` without `origin` is still stale-checked, and it still writes the old event (`:561`) |
| C6 | Page | ✅ **Row states.** There are three, chosen through `sameRate` only and in the SA-1e-1 order: (1) in the accepted set, or the row holds the suggestion; (2) the row holds the base; (3) the rate changed. The colour comes from the server's exact `direction` and always has words. `not_in_feed` reads "No public rate", never 1. **Link.** `href={ECB_SOURCE_PAGE_URL}`, `target="_blank"`, `rel="noopener noreferrer"`, an `aria-hidden` icon and an `sr-only` " (opens in a new tab)". There is no URL text in the page folder. **Tile.** It covers ok, "No sync on record" and "Could not check". The visit's own sync comes ahead of the GET's, and a failed sync leaves the tile alone. **Button and answers.** The button is disabled while syncing and while `!payload`. `syncRequest` drops an answer that arrives after unmount or after a newer sync; the probe and its control are both tested. Accept reuses `patch`, so there is no new `fetch(`. **Pins.** G-6 is **4** and still enforced. In `KpiStrip.callers.pin` only the seven Exchange rates hashes moved. **D-5.** No money amount, total or USD figure appears anywhere. The gap is a difference between two rates of one currency (SQ-42) |
| C7 | Docs | ✅ Docs only. See finding 2 for the C7 check command |

**Each commit on its own.** SA traced every import chain, and there is **no forward dependency**:
- **C2** imports only what is on `main`: the type `ExchangeRatesPayload`, `isPositiveRate`, `BASE_CURRENCY`, `isRealDate` and `decimal.ts`.
- **C3** imports C1 and C2.
- **C4** imports C1 (the sync event constant) and C2 (`ExchangeRatesReadPayload`).
- **C5** imports C2 (`rateMath`).
- **C6** imports C2 (`rateSyncRules`) and the C5 body type.

The test helpers it uses (`noRealNetwork.ts`, `bos-llm-literal-rules.ts`) are already tracked. At C3 the source guard sees no page use of the URL, which its "at most once" rule allows (DV-1). The RM's detached-checkout proof still runs as planned.

#### Code Review Comments

1. **`lib/admin/exchangeRates/ecbRates.ts:43`, `RATE_LOOSE`: quadratic, not linear, and it misses one silent-drop shape. Priority: Medium (required).**
   - **Why it is quadratic.** The pattern is `<Cube`, a word boundary, then a run of "anything but `>`", then the self-close. That run also matches `<`. On input with no `>`, every `<Cube` start scans to the end of the input and then backtracks.
   - **Measured by SA on Node:** 12 KB took 183 ms, 36 KB took 1.4 s and 78 KB took 4.9 s. At the 64 KB cap that is about 3.5 s of blocked event loop.
   - **How much it matters.** E1 and E2 run first but are trivial to satisfy. The source is a pinned HTTPS host, so the realistic risk is small. It still breaks the SA-1e-3 rule ("each pattern is linear") and DV-3's own claim.
   - **The missed shape.** A rate line with an explicit close tag (`<Cube currency='GBP' rate='0.83728'></Cube>`) has no self-close. Neither count sees it, so it is dropped silently, which is exactly the case E3 exists for.
   - **Fix (C2 files only):**
     - (a) Make the run "anything but `<` or `>`" (a character class of `<` and `>`, negated). No two scans can then overlap, so it is linear: about 0 ms at 78 KB, measured.
     - (b) Also require the strict count to equal a plain global count of `currency=`. That count is linear and does not depend on attribute order.
     - (c) Add three cases to `ecbRates.test.ts`: 64 KB of `<Cube ` with the sender name and time anchor kept returns E3 within a generous bound (for example 1,000 ms); an explicit-close rate line returns E3; the fixture still parses.
     - (d) Update the DV-3 row to match what is built.
2. **`docs/workplans/ADMIN_EXCHANGE_RATES_SLICE_1E_WORKPLAN.md`, Commit plan, row C7: the check command cannot pass as written. Priority: Low (no code change).**
   - **The problem.** Both docs already hold backslash-plus-hex text: quoted regexes from §13.7 and DV-3, and the Windows worktree path in Commands. So "`grep -c` shows no backslash-hex text" is false today, and running it would stop the RM for nothing.
   - **Why it is safe.** `app/globals.css` excludes the whole folder (`@source not "../docs"`, PR #180), so text in these docs cannot reach the Tailwind scan.
   - **Ruling.** For C7 the RM confirms that this exclusion is still in place, and does not block on the grep.

#### Rulings on the deviations

| # | Ruling |
|---|---|
| DV-1 | ✅ **Accepted.** "At most once, and only as `href`" in C3, plus "exactly one link" in the C6 render test, together give the SQ-49 (3) guarantee and keep every commit green |
| DV-2 | ✅ **Accepted.** §13.8 step 10 cited the wrong line. `:294` is the `?currency=` body, which must not gain `lastSync` (SQ-51 (3)). The exact-keys pin is the right forced edit |
| DV-3 | ✅ **Accepted, amended by F-1.** Widening the loose count to every self-closing tag is right, but the run must exclude `<` as well, and the `currency=` count is added |
| DV-4 | ✅ **Accepted.** BQ-2 says no colour when equal, and `neutral` without an icon is the shared component's own rule. "Accepted" in `info` cannot be read as the green "in our favour" |
| DV-5 | ✅ **Accepted.** An unknown is not a "no". It also keeps the other suites that mount the view unedited, as §13.8 requires |
| DV-6 | ✅ **Accepted.** A repository importing from `app/` would be a new pattern. The private check does the same UTC round trip |
| DV-7 | ✅ **Accepted.** When no feed was read there is no status to record. The anchor in the log line is enough for diagnosis |
| DV-8 | ✅ **Accepted.** WCAG 2.5.3: the accessible name starts with the visible label (K-7) |
| DV-9 | ✅ **Accepted.** One sentence for "takes no input" |
| DV-10 | ✅ **Accepted.** The new field is in the log line only. A manual edit's audit `details` are pinned unchanged |
| DV-11 | ✅ **Accepted.** Keeping the case name avoids a rename. Only the Exchange rates hashes moved (diff checked) |
| DV-12 | ✅ **Accepted** |

Q-1 to Q-4 are accepted as built. On Q-1: SA-1e-2 placed the button "beside Refresh", but Refresh now sits inside the shared `AdminFilterBar`. The action row under it leaves every shared layout file unedited, which is the better choice.

#### Optimisation Suggestions (non-blocking)

- **`ecbFeed.ts:104-108`.** The fallback used when there is no body reader (`response.text()`) has no streaming cap. It was copied as-is, as SQ-36 requires, and a real `fetch` always has a body stream. Record it in FU-1e-1 so the lift fixes both copies.
- **`AuditTrailRepository.ts`.** The new exported `EXCHANGE_RATE_ENTITY_TYPE` repeats `'exchange_rate'` from `AUDIT_ENTITY_TYPES`. It is harmless; reuse that constant on a later touch.
- **`rateSyncRules.ts`, `syncOutcomeText`.** An outcome outside the type would return `undefined`. The server bounds the type, so a generic fallback sentence is optional.

### Code Approved for QA: Yes, once F-1 is fixed (SA checks the F-1 diff only)

---

## QA Testing Report

_QA populates this section (one pass for the whole slice)._

**QA — 2026-10-25**
**Test mode:** full
**Strategy used:** A (unit: maths, parser, rules) + B (route integration with mocked repositories, the real `logAndFlush`, an injected / stubbed fetch that never reaches the network) + render tests + D prepared (manual click-through listed below, for the user). Scratch probes were run from the session scratchpad through a throwaway Jest config, so they add no file to the repo.
**Focus:** all (api, ui, schema, security)
**Skipped:** the live browser check. It is the user's click-through (SA-1e-8 gate), listed below.
**Input source:** prompt keywords (TL brief) plus the workplan Commands block

**Verdict: FAIL on one item, SA F-1 (still open in the tree).** Every other criterion passes. F-1 is already raised by SA and owned by Dev, with C2 files only. Once it lands, QA re-runs `ecbRates.test.ts` and the sync route suite, and nothing else.

### Test Coverage

**Runs**

| Run | Result |
|---|---|
| Narrow Jest set (workplan Commands), `--ci`, at Dev's tree | 121 suites (120 passed, 1 failed); 4,842 tests (4,836 passed, 6 failed). Same as Dev's step 14 |
| The 6 failures | All in `openaiPricingAdapter.test.ts`, and all are the local CRLF baseline. `lib/ai/pricing-research/**` is byte-identical to `origin/main` (`git diff --quiet origin/main`). The `origin/main` blob of `openai-pricing-2026-10-14.md` has 0 CR. Locally it is `i/lf w/crlf` (`core.autocrlf=true`). Re-run with the fixture served as LF: **27 / 27 pass** |
| The same narrow set with every file read served as LF (CI-checkout parity) | **121 / 121 suites, 4,842 / 4,842 tests green.** So no 1e source guard depends on the local CRLF |
| Sync route suite after the QA additions | 42 / 42 (32 by Dev + 10 by QA) |
| `app/admin/components/layout/__tests__` (including `layoutFolder.guard`, not in the narrow set) | 20 suites / 807 tests green |
| Guard list re-run on its own | 10 suites / 1,701 tests green: `redundantPages` (G-6 `toBe(4)`), `rateSync.source`, `adminReadMethods.guard`, `admin-authz-surface`, `eventAudience` (220 / 60 / 76 / 84), `filterOptions.guard`, `filterOptions.test`, `KpiStrip.callers.pin`, `finance.source.guard`, sync route |
| Finance guards and pins (`app/admin/finance`), price review suites (`lib/ai/pricing-research`, `app/api/admin/model-pricing`, `app/admin/system-config/__tests__`) | Green, apart from the CRLF baseline. No file changed |
| `eslint` on the QA-edited test file | Clean |

**§8 slice 1e criteria**

| Criterion (§8 slice 1e) | Tested? | Result | Where |
|---|---|---|---|
| 1e.1 Sync button; disabled and `aria-busy` while running | ✅ | Pass | render "disabled and aria-busy while a sync runs". QA probe: three quick clicks send **one** POST |
| ILS / EUR / GBP only; USD "Base, always 1"; disabled "Not synced (disabled)" | ✅ | Pass | sync route happy path; render "every §5.7.5 row state" |
| Route: non-admin refused with no fetch; any body key 400 with no fetch; happy path 200 | ✅ | Pass | sync route: 401 / 403 (no read, no fetch, no audit); URL / currency list / rate → 400; bad JSON → 400 |
| Parser and rate values (3.121505 / 0.748039 / 0.893416), half-up, no float, no USD → `layout_changed`, missing currency "No public rate" | ✅ | Pass | `rateMath`, `ecbRates`, `rateSync.source` (no float), render "No public rate never shows as 1" |
| Gap maths, worked case, red / green / no colour, words and icon | ✅ | Pass | `rateMath` (+0.610000 / +19.74%); render "red, green and no colour" |
| Suggested cell: source, rate date, fetch time UTC; weekend → last working day | ✅ | Pass | render status line. The route test's clock is Sunday 2026-10-25 and the rate date is Friday 2026-10-23 |
| Fetch failures (timeout, 5xx, 4xx, 3xx, HTML, over cap), each with its own sentence; table still works; no rate change | ✅ | Pass | `ecbFeed` per outcome; render, per sentence, with edit still working. **QA added route-level cases** (see Test Outputs) |
| One `EXCHANGE_RATE_SYNC_RUN` per sync, `logAndFlush`, audit failure does not fail, no feed body | ✅ | Pass | sync route "the audit (SQ-47)" |
| Nothing written by the sync | ✅ | Pass | The repository mock holds `listAll` only, and a source scan finds no write call |
| Suggestions survive Refresh, save and Show; gone after reload or leaving the tab | ✅ | Pass | render "survive Refresh…". QA probe: remount → no Suggested column, no status line |
| Before the first sync, the table is exactly as today | ✅ | Pass | render headers equal `TODAY_HEADERS`. Older render suites unedited |
| SA-1e-1 row states (gap / rate changed / Accepted) | ✅ | Pass | render "manual edit to another value" / "to the suggested value" |
| **Parser anchors E1 to E5; E3 "fails loudly, never drops a currency silently"** | ⚠️ | **Fail (F-1)** | E1 to E5 cases are green, and the DV-3 attribute swap fails E3. But QA confirmed SA F-1: an explicit-close line `<Cube currency='GBP' rate='0.83728'></Cube>` parses `ok` **without GBP** (a silent drop). 64 KB of `<Cube ` takes **2,619 ms** in `parseEcbDaily` (SA measured about 3.5 s) |
| Fetch limits (64 KB declared or streamed, HTML / 403 blocked, JSON `layout_changed`, headers, manual redirect, no-store, no cache) | ✅ | Pass | `ecbFeed.test.ts` |
| `+0.000001` → `+0.00%` and red | ✅ | Pass | `rateMath` (direction from the exact compare) + render tone mapping |
| `PATCH …/sync` → 405 | ✅ | Pass | The module exports `POST` only (Next answers 405 for an unexported method). No existing test sends it |
| `rateSync.source` guard | ✅ | Pass | Green, with planted controls |
| G-6 3 → 4; finance, KpiStrip, `app/admin/finance/**` | ✅ | Pass | G-6 `toBe(4)`. KpiStrip pin amended per SQ-51 (7) (SQ-48's "unchanged" superseded). Finance untouched |
| 1e.2 Accept: accessible name; none on no-suggestion rows | ✅ | Pass | render "appears only in state (2)" |
| Accept sends the PATCH; then "Accepted", fresh date, no Stale, history re-read | ✅ | Pass | render "sends the exact PATCH body…" (body now carries `expectedRate` and `origin`, per SQ-43 / SQ-44) |
| Equal → "Confirm (no change)", no history row | ✅ | Pass | render + PATCH "confirm … unchanged true" |
| Refused save shows the error; stored rate stays | ✅ | Pass | render "a 409 shows the server's sentence" |
| No "Accept all"; nothing saved without a click | ✅ | Pass | render |
| 409 `rate_changed`: no write, no audit; `3.09` vs `3.090000` → 200; without `expectedRate`, as today | ✅ | Pass | PATCH route suite |
| `origin` rules: unknown key, bad date, other source → 400; on the `enabled` branch → 400 | ✅ | Pass | rules + PATCH route. `origin` without `expectedRate` → 400; `expectedRate` alone → 200 and `EXCHANGE_RATE_UPDATED` |
| No amount on the page (D-5) | ✅ | Pass | render "no amount and no total" |
| D-10 source line and link (`_blank`, `noopener noreferrer`, sr-only, exactly one link) | ✅ | Pass | render "the source line is there before and after a sync" |
| Guards for the link (two pinned `https://` literals; page URL only as `href`) | ✅ | Pass | `rateSync.source` (in `rateSyncRules.ts`, per SQ-49 (2)) |
| Accept audit: exactly one `EXCHANGE_RATE_SUGGESTION_ACCEPTED`, server gap (+0.031505 / +1.02%), confirm `unchanged: true`; manual edit unchanged; 409 / 400 no audit; registry and pin | ✅ | Pass | PATCH route suite, `eventAudience`. QA probe: both events are `info` + `SOC2` |
| Audit Trail Action filter offers both events, with the page unedited | ✅ | Pass | `filterOptions.guard` green. QA probe of `buildActionFilterGroups()`: both appear under "Exchange" ("Exchange Rate Sync Run", "Exchange Rate Suggestion Accepted") |
| "Rates last checked" tile: ok / "No sync on record" / "Could not check"; updates at once; after a reload from the GET; failed sync leaves it; GET still 200 | ✅ | Pass | render D-10 describe + GET route "slice 1e: lastSync" |
| Repository read | ✅ | Pass | `AuditTrailRepository.latestExchangeRateSync` (13) + `adminReadMethods.guard` |
| KpiStrip pin; one PR | ✅ / — | Pass / RM | The pin is green. The one-PR rule is the RM's step |

### Issues Found

#### Bugs (must fix before commit)
1. **SA F-1 confirmed: the E3 loose count is quadratic, and it misses an explicit-close rate line.** File: `lib/admin/exchangeRates/ecbRates.ts:43` (`RATE_LOOSE = /<Cube\b[^>]*\/>/g`). Severity: Medium (required by SA). It is already owned by Dev, with C2 files only. QA adds nothing to SA's fix.
   - Steps: (a) `parseEcbDaily` on the fixture head plus `'<Cube '` repeated up to 64 KB; (b) the fixture with GBP's line rewritten as `<Cube currency='GBP' rate='0.83728'></Cube>`.
   - Expected: (a) E3 in a few ms; (b) E3 (a loud failure).
   - Actual: (a) E3 after **2,619 ms** of blocked event loop; (b) `ok: true` with GBP **missing**, so the GBP row would read "No public rate" instead of failing the sync.

#### Performance Issues (should fix)
- None beyond F-1.

#### Edge Cases (nice to fix)
1. **After a 409, the row still shows the old base rate and still offers Accept.** The view does not re-read on a refused accept. A second click gets the same 409, until Refresh or a new sync. FR-9 ("leaves the stored rate showing") is met for the value the page knows. A re-read on `rate_changed` would show the other admin's value. Low.
2. **The tile's time can move by up to the fetch duration after a reload.** The visit's tile uses the sync answer's `fetchedAt`, which is taken before the fetch. After a reload it reads the audit's `created_at`, which is written after the fetch. The two can differ by a few seconds, up to about 20 s on a retry, so the minute shown can change. Cosmetic.
3. **Requirement text lags the SA rulings.** §8 and FR-50 to FR-55 still say "Never" (SQ-51: "No sync on record"), a header tooltip (SQ-49: removed), the constants in `exchangeRateRules.ts` (SQ-49: `rateSyncRules.ts`), and `origin` recorded in `EXCHANGE_RATE_UPDATED` (SQ-50: the new event). The code follows the SA rulings. The §13.8 "BA record edits" 1 to 5 are still owed. Docs only, and they do not gate Dev.

### Tests added by QA (real gaps only, in a new 1e file)

`app/api/admin/exchange-rates/sync/__tests__/route.test.ts`: one appended describe, "QA: the feed fails in every way → 200, outcome, nothing written", with 10 cases. Before this, the route-level suite covered only 404 / 403 / HTML / JSON / E1 / 5xx. The new cases cover:
- a 301 (not followed, one fetch);
- a declared content-length over 64 KB;
- a streamed body over 64 KB;
- the feed down (two network errors, two fetches);
- an HTML page with a charset;
- E5 with no USD, and E5 with USD at zero;
- a 10 s timeout under fake timers (one attempt);
- a zero GBP rate (that row only `no_usable_rate`, with ILS and EUR still suggested);
- the DV-3 attribute swap at route level.

Each case asserts a 200, the exact empty answer, the fetch count, a repository with `listAll` only, and one sync entry with `currencies: []`. No product code was changed. The file stays in C3 (it is already in the C3 file list). Line endings are normalised to CRLF to match the rest of the file.

### Test Outputs / Logs

```text
Narrow set (--ci):   Test Suites: 1 failed, 120 passed, 121 total | Tests: 6 failed, 4836 passed, 4842 total
  FAIL lib/ai/pricing-research/__tests__/openaiPricingAdapter.test.ts  (A2 x1, A3 x2, A4 x2, SA F-5 x1: CRLF baseline)
Narrow set, LF-served reads:  Test Suites: 121 passed, 121 total | Tests: 4842 passed, 4842 total
openaiPricingAdapter, LF fixture:  Tests: 27 passed, 27 total
Sync route suite (with QA cases):  Tests: 42 passed, 42 total
Guard list:  Test Suites: 10 passed | Tests: 1701 passed
Layout folder:  Test Suites: 20 passed | Tests: 807 passed
QA probes (scratch): 3 quick clicks → 1 POST; remount → no Suggested column; filter groups hold both events
F-1 probe:  bytes=65532 ms=2619 result={"ok":false,"anchor":"E3"} | explicit close → ok, GBP present: false
```

### Manual click-through for the user (SA-1e-8)

On `/admin/finance?tab=exchange-rates`, as a platform admin:
1. The source line sits beside **Sync rates**. The link opens the ECB page in a new tab, and this tab stays open. The third tile reads "No sync on record" (or an earlier sync).
2. Click **Sync rates**. The button greys out and reads "Syncing…". The Suggested rate and Gap columns appear for ILS / EUR / GBP. USD reads "Base, always 1". Under Show = All, a disabled row reads "Not synced (disabled)". The status line shows "ECB · rates of {date} · fetched {HH:MM} UTC". The tile updates with no reload.
3. Gap: red with words when the ECB rate is above ours, green when below, "No change" with no colour when equal.
4. **Accept** one row: it reads "Accepted", the rate equals the suggestion, "Last updated" is now, and a history row appears. On a row with an equal rate, **Confirm (no change)**.
5. Edit a synced row by hand to another value: it reads "Rate changed since the sync. Sync again.", with no Accept.
6. In a second tab, change ILS, then press Accept in the first tab: "This rate changed since you synced. Sync again.", and nothing is saved.
7. Reload: the columns are gone, and the tile still shows the last sync.
8. Audit Trail → Action filter: "Exchange Rate Sync Run" and "Exchange Rate Suggestion Accepted" each show the entries. The manual edit shows as Exchange Rate Updated.

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] Issues found — Dev must address before commit: **SA F-1 only** (Medium). The edge cases are optional

---

## Commit Info

_RM populates this section, following the [Commit plan (RM)](#commit-plan-rm)._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-25 | Created | Dev workplan for slice 1e.1 from §13.7 (plan only, no code, at the user's request). Verbatim `sed` quotes of the §1 row 1e, D-9, BQ-2 / BQ-3, §5.7, FR-35 to FR-44, §8 slice 1e.1 and all of §13.7. Q-1 to Q-4 raised (button placement, disabled-after-sync row, local × 100, cell plus status line); every ruling followed. Baseline not yet run |
| 2026-10-25 | Renamed and extended to the whole slice 1e | Renamed from `ADMIN_EXCHANGE_RATES_SLICE_1E1_WORKPLAN.md` (SQ-52 (4)). Worktree fast-forwarded `90e739be` → `7e51af5b`. Task list replaced by the §13.8 Dev steps 0 to 14; "In plain words" rewritten (source line and link, sync and accept audit entries, the "Rates last checked" tile, Accept / Confirm and the 409); new "Commit plan (RM)" with C1 to C7; baseline recorded; §13.8 and the D-10 row quoted verbatim with `sed` |
| 2026-10-25 | Built (uncommitted) | All of 1e built per the §13.8 Dev steps 1 to 13 and checked (step 14): narrow Jest 121 suites / 4,842 tests, the only failures the 6 baseline CRLF cases; narrow `tsc` 0 errors; `eslint` 0 errors; `lint:hooks` clean; 32 files, each in exactly one of C1 to C7; no migration, no dependency. Deviations DV-1 to DV-12 recorded. Awaiting the combined SA code review |
| 2026-10-25 | SA code review (combined, C1 to C7) | APPROVED-WITH-CHANGES. F-1 (Medium, required): `ecbRates.ts` `RATE_LOOSE` is quadratic (about 3.5 s at the 64 KB cap) and misses rate lines with an explicit close tag. Fix: the run must also exclude `<`, add a `currency=` count, add three tests; C2 files only. Finding 2 (Low): the C7 grep check cannot pass; the docs folder is already outside the Tailwind scan. DV-1 to DV-12 accepted, DV-3 as amended. Narrow Jest re-run by SA: 80 suites / 4,050 tests green; untouched list clean; no forward dependency between commits |
| 2026-10-25 | QA pass (full) | FAIL on SA F-1 only (confirmed: 64 KB of `<Cube ` takes 2,619 ms; an explicit-close rate line is dropped silently). All other §8 slice 1e criteria pass. Narrow Jest `--ci` 121 suites / 4,842 tests, the 6 failures are the CRLF baseline (27 / 27 with the fixture served as LF; identical to `origin/main`); with every read served as LF, 4,842 / 4,842. Guards, layout folder, finance and price review suites green. QA added 10 route-level failure cases to the sync route test (C3). Three edge cases and the user click-through recorded |
| 2026-10-25 | Dev: SA F-1, QA edge 1, SA FU note | **F-1:** `RATE_LOOSE` is now `/<Cube[^<>]*/>/g` (linear) and E3 also requires the strict count to equal a plain `currency=` count; three `ecbRates.test` cases added (adversarial 64 KB in 1 to 2 ms, under a 250 ms limit; explicit-close GBP → E3; fixture parses); DV-3 updated (C2). **QA edge 1:** after a 409 `rate_changed` on Accept the view re-reads the plain list through the existing `load` (`patch` gains an optional `onRefused(status)`), so the row shows the new rate and "Rate changed since the sync" instead of a stale Accept; no new `fetch(`, G-6 stays 4; two render tests (409 re-reads; another refusal does not), with a mutation check (C6). **SA note:** the uncapped `response.text()` fallback in `readCapped` is added to the FU-1e-1 note in `ecbFeed.ts` (comment only, C3) |
