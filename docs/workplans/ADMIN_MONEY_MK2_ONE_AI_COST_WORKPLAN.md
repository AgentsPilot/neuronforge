# Workplan: Money MK-2, one charged AI cost figure

> **Last Updated**: 2026-10-26

**Developer:** Dev
**Requirement:** [ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md) §2 ("Approved fix", "How the tile is computed"), §4 (A-K1), §12 MK-2 row, SA-RR-MK (SA-1 as changed, SA-7, pin table row MK-2)
**Branch:** `feature/admin-money-mk2-one-ai-cost` (from main `0ca7ea6f`; **rebased by hand onto `origin/main` `6e19cbe4` on 2026-10-26**, see §R)
**Date:** 2026-10-19
**Status:** Code Approved (SA-CR-MK2), QA passed, TL approved; committed `5452be3c` on `6e19cbe4`, PR [#516](https://github.com/AgentsPilot/neuronforge/pull/516) opened 2026-10-26, auto-merge on. RU-19 and Q-R1 ruled by SA
**Path:** full cycle (money figure, 4a behaviour, Pin C). The user approved running the MK slices back to back. No migration, no new repository method, no Finance payload change.

## Overview

Charge checks (`/admin/finance/charges`) shows "Charged AI cost (USD)" from the stored totals of **whole billing periods**, over a **30-day** default window, and **leaves out deleted accounts**. Finance's Section 3 / K-1 counts charges **created** in the window, deleted accounts included. MK-2 makes the Charge checks cost tile the **same computation** as Finance's (SA-1): the same ledger read (R-a / R-a′), the same cut-over clamp and the same builder (`summariseAiCost`). The default window becomes **This month**. The period table keeps whole periods, now labelled "Whole billing periods: can include charges from before the window", and no longer feeds the tile. Deleted accounts get their own line. Same page and routes (the page merge is MK-3).

---

## R. Rebase onto `6e19cbe4` (2026-10-26)

Page 1 (MK-0a, MK-1, MK-4 to MK-10) landed while MK-2 waited. The WIP (24 files) was copied to the session scratch, the tree reset, fast-forwarded to `origin/main` `6e19cbe4`, and MK-2 re-applied by hand. Nothing stashed or committed.

| File | Changed on main since `0ca7ea6f`? | How MK-2 was re-applied |
|---|---|---|
| 17 MK-2 files (Charge checks UI, copy, types, filters, route, credit report, wire types, Pin C table, 4a tests, importer guard) | No | Copied back byte-for-byte |
| `chargedAiCost.ts`, its test, this workplan | New | Copied back |
| `lib/business-os/finance/financeHealth.ts` | Yes (+240 / −4: MK-5b converted, MK-9 paying, drawers) | The same five edits re-applied; the read code they touch was unchanged (now `:214`, `:641`, `:644`, `:732`) |
| `financeHealth.test.ts` | Yes (+361) | The MK-2 import and describe re-appended; one case added (Q-R1) |
| Pin A `KpiStrip.callers.pin.render.test.tsx` | Yes (MK-0a re-freeze, new callers) | The ruled fixture line re-added; the two `CostsKpis` entries re-frozen against main's values (RU-14/15 below) |
| `ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md` | Yes | SA-PIN-MK2's MK-2 pin-table row (never committed) re-applied; nothing else |

**Assumptions re-checked on `6e19cbe4`:**
- **F-K3 is now the strip tile** (`FinanceKpiStrip.tsx:10`, MK-5). It is K-1 (`financeHealth.ts:1432`, `:1550`): this month to `now`, through `readSpan` → `readLedger`, which is now the shared `readChargedLedger`. So the same read serves Section 3, F-K3 and the Charge checks tile. With This month picked, the tile equals F-K3: new test case "This month: equals the strip tile F-K3 (K-1) as well as Section 3".
- **MK-5 tile rules**: F-K3's colour (BD-11 amber and red, `k1_ai_cost`) and `$` display are Finance-strip only; the Charge checks tile keeps its neutral rule (SA M-1) and its existing `formatUsd`; `$`-sign display (`formatUsdSign`) is MK-3's for the AI cost page.
- MK-3 (the `/admin/ai-cost` page) has **not** landed: Charge checks is still `/admin/finance/charges`, mounting the same `CostsTab`.
- `CostsKpis` still passes no `indicator` (MK-3 adds A-K1..A-K5 icons).

**Q-R1 for SA (one known divergence):** on an **unreadable amount**, F-K3 shows Unknown (`k1Measured` returns null), while Section 3 and the Charge checks tile (same builder, `summariseAiCost`) count it as 0 and show "at least". Equal in every other case. MK-2 follows Section 3, as SA-1 ruled ("Finance's existing charged-cost builder"). Should A-K1 follow F-K3's stricter rule instead, in MK-3?

## 1. Code facts (at `0ca7ea6f`; line numbers in financeHealth.ts moved, see §R)

| # | Fact | Where |
|---|---|---|
| CF-1 | Default window is 30 days on the client | `app/admin/business-os-llm/costsFilters.ts:33` (`COSTS_DEFAULT_WINDOW = '30d'`) |
| CF-2 | The route's own default (no dates) is also 30 days | `app/api/admin/business-os/credits/report/route.ts:129-132`; `lib/business-os/credits/creditReport.ts:72` (`DEFAULT_WINDOW_DAYS: 30`) |
| CF-3 | The report reads totals and rows on `period_start` in `[start − 31 d, end)` | `creditReport.ts:233-240` |
| CF-4 | Rows are read only for accounts with a totals row, and NULL accounts are dropped, so deleted accounts are never read | `creditReport.ts:274`, `:323` |
| CF-5 | The tile shows the stored period total | `CostsKpis.tsx:88-94` (`grandTotal.stored.costUsd`); `creditReport.ts:386-393` (`grandStored`) |
| CF-6 | Finance reads R-a / R-a′ (`listRowsOfAllAccountsCreatedInRange` / `listRowsForAccountCreatedInRange`) with `{ pageSize: 1000, ceiling: 20000 }` | `lib/business-os/finance/financeHealth.ts:191-193`, `:505`, `:574-581` |
| CF-7 | Section 3's window read is the selected window clamped to the charging cut-over | `financeHealth.ts:583` (`cutoverClamp`), `:670` |
| CF-8 | Section 3's total and the deleted bucket come from `summariseAiCost`; `exact` = no ceiling and no unreadable amount; status `ok` / `partial`, `unknown` on a failed read | `lib/business-os/finance/aiCost.ts:108-207` (deleted `:151-153`, exact `:182`); `financeHealth.ts:786-829` |
| CF-9 | Originals (adjusted charges outside the read) change only trigger attribution, never the total or the deleted bucket | `aiCost.ts:111-114`, `:144-153` |
| CF-10 | Pin C = `chargeChecksRequest.pin.render.test.tsx` (`98ea0507`) plus its table `chargeChecksRequestPins.ts` (`02813360`). Rows 1, 7, 9, 10 carry the default window `from=2026-09-17` | `app/admin/finance/__tests__/chargeChecksRequestPins.ts:35`, `:44`, `:49`, `:50` |
| CF-11 | The Leak check's own window (yesterday, at most 7 days) does not follow the report default | `LeakCheckPanel.tsx`; Pin C leak literals |
| CF-12 | The client payload type is re-declared and pinned both ways against the server type | `app/admin/business-os-llm/costTypes.ts:81-111`; `lib/business-os/credits/__tests__/creditReport.wireTypes.test.ts:20-22` |

## 2. Reuse plan (SA-1: equal by construction)

**New file:** `lib/business-os/finance/chargedAiCost.ts` (scanned automatically by the finance source guard's `walk('lib/business-os/finance')`).

| Export | What it is | Used by |
|---|---|---|
| `CHARGED_LEDGER_READ` | `{ pageSize: 1000, ceiling: 20000 }`, the R-a paging. `FINANCE_LIMITS.LEDGER_PAGE_SIZE` / `LEDGER_CEILING` now point at it (values unchanged) | Finance, Charge checks |
| `readChargedLedger(ledger, accountId, range)` | R-a′ when an account is given, else R-a; settled | Finance (`readLedger`: window, K-1 spans), Charge checks |
| `readChargedWindow(ledger, accountId, { start, end })` | `cutoverClamp`, then `readChargedLedger` from `readFrom` to `end`, or an empty read when the window is entirely before the cut-over | Finance (Section 3's `windowResult`), Charge checks |
| `buildChargedAiCostInWindow(input, logger, deps)` | `readChargedWindow`, then **`summariseAiCost`** (Finance's builder) with no plan groups and no originals (CF-9); returns total, credits, charges, rows, the deleted bucket, `unreadableAmounts` and `status` by Finance's rule | Charge checks route |

Finance keeps calling `summariseAiCost` with groups and originals, so its payload is byte-identical (AC-145 and Pin B unchanged). Both pages now go through **one read function** and **one builder**. The route composes `buildCreditReport` and `buildChargedAiCostInWindow` in parallel and returns `{ ...report, chargedInWindow }`. Imports go finance → credits only, so no cycle.

**Payload:** `CreditReportResponse = CreditReport & { chargedInWindow: CreditReportChargedInWindow }` in `creditReportTypes.ts`; the client mirror gains `chargedInWindow`; the wire-types pin compares the client type with `CreditReportResponse`.

```typescript
export interface CreditReportChargedInWindow {
  status: 'ok' | 'partial' | 'unknown';
  coverage: 'after_cutover' | 'starts_before_cutover' | 'entirely_before_cutover';
  costUsd: number | null; credits: number | null; charges: number | null; rows: number | null;
  deleted: { costUsd: number; credits: number; rows: number } | null;
  unreadableAmounts: number;
}
```

## 3. Screen changes

- **Cost tile** (`costs-kpi-cost`): value from `chargedInWindow.costUsd`. Sub-line "at least" when `partial` (Finance's AT_LEAST rule), "Unknown" when `unknown`. Anchor `#costs-charged`.
- **Credits charged** and **Charges** tiles stay on the stored period totals and gain the sub-line "whole billing periods", so no tile claims to be the window figure when it is not (D-1).
- **New block** `costs-charged` "Charged AI cost in this window": one sentence (charges created in the window, the same figure as Finance for the same window) and the **deleted accounts line** ("Deleted accounts: $x (n ledger rows)" / "No charges from deleted accounts"); hidden with a business picked (deleted is 0 by construction).
- **Period table:** a note under its title: "Whole billing periods: can include charges from before the window". It no longer feeds the cost tile.
- **Default window:** This month.

## 4. Ruled test and pin changes (SA-7, pin table)

| # | File | Before | After | Ruling |
|---|---|---|---|---|
| RU-1 | Pin C table `chargeChecksRequestPins.ts` row 1 | `report=…?from=2026-09-17&to=2026-10-16` | `…?from=2026-10-01&to=2026-10-16` | Pin C, the one ruled re-freeze |
| RU-2 | same, row 7 | `from=2026-09-17&to=2026-10-16&accountId=…` | `from=2026-10-01&to=2026-10-16&accountId=…` | same |
| RU-3 | same, row 9 (`account=nope`) | `from=2026-09-17&to=2026-10-16` | `from=2026-10-01&to=2026-10-16` | same |
| RU-4 | same, row 10 (one-sided custom) | `from=2026-09-17&to=2026-10-16` | `from=2026-10-01&to=2026-10-16` | same |
| RU-5 | Pin C table, header comment | "never edited after that" | adds the MK-2 re-freeze record | same. **Leak literals and rows 2-6, 8 unchanged.** The test file `chargeChecksRequest.pin.render.test.tsx` is **not edited** (`98ea0507` kept) |
| RU-6 | 4a route test `credits/report/__tests__/route.test.ts` "defaults to the last 30 days" | `from = today − 29` | `from = first day of this UTC month` | 4a ruled update |
| RU-7 | same, ledger mock | four report reads | plus R-a / R-a′ mocks, and `noReadHappened` covers them | 4a ruled update (authz-first proof widened) |
| RU-8 | `creditReport.ts` `CREDIT_REPORT_LIMITS.DEFAULT_WINDOW_DAYS: 30` | used by the route | removed; the route defaults to This month | 4a ruled update |
| RU-9 | `creditReport.wireTypes.test.ts` | `CostReportPayload` ⇄ `CreditReport` | `CostReportPayload` ⇄ `CreditReportResponse` | 4a ruled update |
| RU-10 | `costsFilters.test.ts` "defaults to 30 days" / "equals presetQuery(30)" | 30 days, `today − 29` | This month, `YYYY-MM-01` | 4a / L-9a ruled update |
| RU-11 | `costsTab.render.test.tsx` "opens on the last 30 days" | 30-day request | This month request | ruled update |
| RU-12 | `costsLayout.render.test.tsx` "30 days pressed", cost tile label/href | 30 days pressed; `#costs-periods`; stored cost | This month pressed; `#costs-charged`; `chargedInWindow` cost | ruled update |
| RU-13 | Fixtures of `costsTab`, `costsLayout`, `chargeChecks.page` render tests | no `chargedInWindow` | fixture gains `chargedInWindow` (0.0065 USD, deleted 0.0005 / 1 row) | shape only; SA-PIN-MK2 "states" cases ("loading, then the report", "No charges recorded in this window") pass with it unedited |
| RU-14 | **Pin A** `A2 CostsKpis` (on `6e19cbe4`) | `e22045d420bf86b846dbb75148b11d5db550ac05cca812e1f81bc816973d1248` | `15439ff546e934a3c7352bf63f184127bbddfcc8977f95ccbd98d169266ef30e` | SA-PIN-MK2 (1): the cost tile reads `chargedInWindow`; fixture `COSTS` gains `chargedInWindow: { status: 'ok', costUsd: 2.5 }` only. (On `0ca7ea6f` it was `3f9aebb9…` → `9fd9564b…`; superseded by the rebase) |
| RU-15 | **Pin A** `A2 CostsKpis no sections` (on `6e19cbe4`) | `e8d692a0abc2ce67f01800166cc086d5fff93aa01b1ce3e11c6cb08d936a2a0a` | `6ee816e2cb93e629a4613a32e456cf75388f9bcd4bee2424cb52796a0f57ede5` | same. All 61 other Pin A entries byte-identical (whole pin: 63/63). (On `0ca7ea6f`: `9cb29377…` → `3b755b07…`) |
| RU-16 | `costsLayout` C-3 (five cases), C-4, C-6 | default read spans 29 days, "30 days" pressed; C-4 clicks "30 days" as the omitted default; C-6 `from=2026-10-02` | default read is `YYYY-MM-01` to today, "This month" pressed; C-4 clicks "This month"; C-6 `from=2026-10-01` | default window (SA-7) |
| RU-17 | `costsLayout` C-12 "incomplete" and "Unknown" | cost tile says "may be incomplete" with the report; "Unknown" when totals fail | cost tile has its own exactness (no report-incomplete sub-line) and keeps its figure when totals fail; the other four tiles unchanged | SA-1: the tile is another read |
| RU-18 | `costsFilters` "the default equals the tab's old presetQuery(30)" | `today − 29` to today, span 29 | `2026-10-01` to today, span 11 (+ a test that 30 days still spans 29) | SA-PIN-MK2 ruled edit |
| RU-19 | Repository importer guard `BusinessOsCreditLedgerReadRepository.test.ts` | 14 importers | + `lib/business-os/finance/chargedAiCost.ts` (types only, like `aiCost.ts`) | **For SA:** not in SA-PIN-MK2. SA expected the importer list to pass; it does not, because the guard matches any mention, type imports included. The route no longer imports the repository: it takes Finance's own wiring (`financeHealthDeps().ledger`), so only the type-only module is added |

**Pins on `6e19cbe4` (LF-normalised sha256 of each file, HEAD → working tree):** **Not moved:** Pin B `a1b3db0c`, Pin D `1f7cf07a`, AC-173 `3a1a2dd4` + helper `b84e0c96`, Pin C test file `98ea0507`, finance route test `5695dd93` with AC-145 `EXPECTED_SHA256` `33340751…2215` (finance route, payload types and their tests untouched). **Moved as ruled, one re-freeze each:** Pin A file `3fa2360a` → `5f537869` (two entries only, RU-14/15); Pin C table `02813360` → `64a565e9` (RU-1 to RU-5, unchanged from the first build). Note: the coordinator's Pin A `e4331716` uses another convention; by this file-hash convention HEAD is `3fa2360a`, and the per-entry hashes above are unambiguous.

## 5. Tests

| # | Test | File |
|---|---|---|
| T-1 | **Equality with Finance:** for the same window and the same ledger fixtures (A, B, a deleted account, a platform account), `buildChargedAiCostInWindow` equals Finance's `aiCost.figures.costUsd`, `credits`, `deleted` and status; also with a business picked; also at the ceiling (both `partial`) and on a failed read (`unknown`) | `lib/business-os/finance/__tests__/financeHealth.test.ts` (new describe, uses its `makeDeps` / `run`) |
| T-2 | The two pages' This month resolves to the same instants: Charge checks dates through `windowInstants` equal `resolveFinanceWindow('this_month')` | `lib/business-os/finance/__tests__/chargedAiCost.test.ts` |
| T-3 | Builder unit cases: account read with exactly the id and R-a not called; entirely before cut-over reads nothing; starts before cut-over reads from the floor; unreadable amount → `partial`; deleted bucket counted; logger on failure | same |
| T-4 | Route: `chargedInWindow` present, window instants passed to R-a, account narrowing to R-a′, R-a failing leaves the report 200 with `chargedInWindow.status = 'unknown'`; 401/403/400/409 make no read (R-a included) | `credits/report/__tests__/route.test.ts` |
| T-5 | Tile shows `chargedInWindow` (not the stored total) when they differ; `at least`; `Unknown`; deleted line shown / hidden with a business; whole-periods label on the table | `costsLayout.render.test.tsx`, `costsTab.render.test.tsx` |
| T-6 | Default window is This month (filters and request) | `costsFilters.test.ts`, Pin C |

## 6. Guards

- `requireAdmin` stays the first statement; the new read runs after Zod and the platform-account 409.
- Repositories only: existing R-a / R-a′, no new method; `rangeCap.source.guard` (pages ≤ 1,000) unchanged and run.
- Tenant isolation: with a business picked only R-a′ with the validated id; R-a only with no business.
- Finance source guard scans the new file (no write verb, no usage-log name, no console, no tier literal, no livemode).
- Vocabulary guard: new copy in `costCopy.ts` says "Charged AI cost", never a forbidden phrase. FC-1: "AI" named; no generic `costs` / `grossMargin` names added.
- `test:authz-guard`, `test:bos-entitlements`, `lint:hooks`, scoped tsc with a canary.

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | Refactoring Finance's read changes its payload | Same function bodies moved, same opts; Finance suites, AC-145, Pin B unchanged |
| R-2 | A second read per Charge checks request (load) | Same bounded R-a Finance already does; runs in parallel with the report |
| R-3 | Tile and table disagree visibly | That is the point; the table carries the whole-periods label and the new block explains the tile |
| R-4 | Window up to 92 days at 20,000-row ceiling | Ceiling → `partial`, "at least" |
| R-5 | D-1 (sub-line on two other tiles) is beyond the letter of the scope | Presentation only; raised for SA |

## Decisions for SA

- **D-1:** "Credits charged" and "Charges" stay on whole periods (out of MK-2 scope) but gain the "whole billing periods" sub-line. MK-3 drops them from the strip.
- **D-2:** the route's own no-dates default also becomes This month (RU-8), so client and server agree.

## Task List

- ✅ Step 0: record pin hashes (AC-173 `3a1a2dd4`, helper `b84e0c96`, A `30f5fc24`, B `24ff0da7`, C `98ea0507`, helper `02813360`, D `1f7cf07a`)
- ✅ Step 1: `chargedAiCost.ts`; Finance reads through it
- ✅ Step 2: payload types + route
- ✅ Step 3: UI (tile, block, label, default window)
- ✅ Step 4: ruled test updates RU-1 to RU-19, new tests T-1 to T-6
- ✅ Step 5: runs and pins

## Implementation Notes

**Stop (2026-10-19): Pin A moves.** Pin A (`app/admin/components/layout/__tests__/KpiStrip.callers.pin.render.test.tsx`) hashes the rendered output of `CostsKpis` itself: entries `A2 CostsKpis` and `A2 CostsKpis no sections` (`:232-233`, `:284-285`, fixture `COSTS` at `:125-132` with no `chargedInWindow`). MK-2's tile change cannot be made without changing those two hashes, and SA-RR-MK's pin table lists only Pin C for MK-2. Per the slice rule, no Pin A edit was made. Today Pin A fails (the fixture has no `chargedInWindow`, so `CostsKpis` throws). Making `CostsKpis` fall back to the stored total when `chargedInWindow` is absent would keep the hash only by adding dead code, so it was not done.

**Asked of SA:** rule a re-freeze of Pin A's two `A2 CostsKpis` entries in MK-2 (fixture gains `chargedInWindow`; new hashes recorded here), or re-scope. `A2 CostsKpis loading` is unaffected.

**State at the stop (uncommitted):** Finance suites green, Pin C green with its ruled re-freeze, Pin B / D / AC-173 / AC-145 files untouched. Failing as expected until the ruled updates are written: `costsFilters`, `costsLayout`, `costsTab`, `chargeChecks.page` render fixtures, and the 4a route test (RU-6, RU-7, RU-10 to RU-13).

**Resumed after SA-PIN-MK2 (2026-10-19).** Pin A re-frozen as ruled (RU-14, RU-15); no fallback; the remaining ruled updates applied.

**Route wiring change:** the route passes `financeHealthDeps().ledger` (Finance's production wiring of R-a / R-a′) instead of importing the repository singleton, so the importer guard gains only the type-only module (RU-19). The route test keeps the singleton mock (via `requireActual` plus a `supabaseServer` stub, because `aiActivity` needs the module's real constants).

**Tests added:** T-1 six cases in `financeHealth.test.ts` ("MK-2: Charge checks' charged AI cost equals Finance's for the same window": all businesses, same R-a call, one business, ceiling, failed read, custom window); T-2 + T-3 nine cases in `chargedAiCost.test.ts`; T-4 four route cases; T-5 three render cases in `costsLayout.render.test.tsx`.

**Runs (on `0ca7ea6f`, 2026-10-19; superseded by the re-run on `6e19cbe4` below):**

| Run | Result |
|---|---|
| `app/admin/business-os-llm` | 17 suites, 856 passed |
| `app/admin/finance` | 20 suites, 687 passed (Pin B, Pin C, AC-173) |
| `app/admin/components` | 26 suites, 846 passed (Pin A) |
| `lib/business-os/credits` | 33 suites, 1004 passed |
| `lib/business-os/finance` | 21 suites, 1983 passed (finance source guard scans the new file) |
| `lib/repositories` | 112 suites, 2696 passed (after RU-19) |
| Range-cap guard | 21 passed |
| Layout (C-14), contrast, vocabulary guards | 3 suites, 661 passed |
| `test:authz-guard` | 2 suites, 203 passed |
| `test:bos-entitlements` | 297 suites, 9002 passed |
| `lint:hooks` | exit 0 |
| Scoped tsc (22 changed files) with a canary | canary TS2322 at `chargedAiCost.ts(131,5)`; restored with `cp`, `cmp` identical (sha256 `8792fd94d78a461e…` before and after); clean run 0 errors |
| `typecheck:bos-llm` (wire-types pin) | passed, 0 new |
| Full gate (`npm run test:gate`) | 1570 suites (1558 passed, 12 failed), 40,074 tests (40,019 passed, 21 failed, 34 skipped), 1016 s. **9** of the failures are the known Windows-local set (CRM contact-drawer guards ×3, onboarding ×2, `supabaseFetch`, `oneAddressPolicy`, `publicEndpointsAreThrottled`, the OpenAI pricing adapter). The other **3** (`priceDecision.render`, `PlanDrawer.prefetch.render`, `PlanSection.prefetch.render`) were load timeouts: re-run alone, 3/3 suites and 42/42 tests pass, and none touches an MK-2 file. The 11 quarantined suites (V6 ×3, v4, pilot ×5, `TokenBudgetManager`, `IntentClassifier`) still fail when run on their own: 11/11. 9 + 11 = **the same 20-suite set; MK-2 adds no failure** |

**Re-run on `6e19cbe4` (2026-10-26):**

| Run | Result |
|---|---|
| `app/admin/business-os-llm` | 17 suites, 856 passed |
| `app/admin/finance` | 27 suites, 920 passed (Pin B, Pin C, AC-173) |
| `app/admin/components` | 27 suites, 907 passed (Pin A, C-14) |
| `app/admin/__tests__` (vocabulary, contrast and page guards) | 16 suites, 628 passed |
| `lib/business-os/credits` | 33 suites, 1018 passed |
| `lib/business-os/finance` | 23 suites, 2276 passed (equality describe: 7 cases) |
| `lib/repositories` (incl. range-cap, importer guard RU-19) | 117 suites, 2802 passed |
| `app/api/admin/business-os/credits` | 5 suites, 127 passed |
| `app/api/admin/business-os/finance` (AC-145) | 2 suites, 131 passed |
| `lib/admin` | 31 suites, 1125 passed |
| Range-cap + layout folder guards | 2 suites, 426 passed |
| `test:authz-guard` | 2 suites, 203 passed |
| `test:bos-entitlements` | 308 suites, 9259 passed |
| `lint:hooks` | exit 0 |
| Scoped tsc (26 touched TS files + `financeHealthDeps.ts`) with a canary | canary TS2322 at `chargedAiCost.ts(131,5)`; restored, `cmp` identical (`8792fd94d78a461e` before and after); clean run 0 errors |
| `typecheck:bos-llm` | passed: 585 files in scope, 11 errors, 0 new. The first run died of out-of-memory (a V8 stack trace and no diagnostics). It was re-run with `NODE_OPTIONS=--max-old-space-size=8192`. The 16 "baseline fixed" entries are not MK-2 files |

## SA Review Notes

### SA pin ruling (2026-10-19, SA-PIN-MK2)

1. **Yes: re-freeze the two Pin A entries, once, in MK-2.** My SA-RR-MK pin table missed that `CostsKpis` is a Pin A caller. Pin A pins every `KpiTile` / `KpiStrip` caller, and MK-2 changes exactly that caller's tile **by decision** (C-6, SA-1). The entries are `A2 CostsKpis` and `A2 CostsKpis no sections` (`KpiStrip.callers.pin.render.test.tsx:232-233`, `:284-285`). The fixture `COSTS` (`:125-132`) gains a `chargedInWindow` value **and nothing else**. Record each entry's **before and after hash** in the Implementation Notes, with the reason. No other Pin A entry may change: re-run the whole pin, and every other entry must stay byte-identical.
2. **No fallback.** Keeping the old hash by falling back to the stored total when `chargedInWindow` is absent would be dead code that hides the change. `chargedInWindow` stays required on the wire type.
3. **The helper's home is right.** `lib/business-os/finance/chargedAiCost.ts` is pure: it has types, `aiActivity` and `aiCost`, no repository and no clock. The charged figure is Finance's definition (BD-18, K-1), so the single copy lives with Finance. It is imported by a **route** (`credits/report/route.ts`), not by `lib/business-os/credits/**` or `lib/business-os/billing/**`, so no placement guard applies. The finance source guard passes, and `routerPlacement` passes (SA ran both). The route's use of `businessOsCreditLedgerReadRepository` is an admin route, an allowed caller; its importer list passes.

**Also ruled edits, not pins.** These ordinary tests change by decision. List each one in §4 with its before and after:
- `costsFilters` "the default equals the tab's old presetQuery(30)": the default is now This month (C-6);
- the costs tab "states" render cases ("loading, then the report"; "No charges recorded in this window"): they need `chargedInWindow` in their fixture.

Pin B, Pin D, AC-173 and AC-145 must stay untouched, as reported.

### SA Code Review (SA-CR-MK2)

**Code Review by SA, 2026-10-26. Reviewed: the uncommitted tree on `feature/admin-money-mk2-one-ai-cost`, on origin/main `6e19cbe4` (24 files).**
**Verdict: CODE APPROVED.** No conditions. One consistency ruling (Q-R1) is recorded for MK-3.

#### Scope (§12 MK-2)

| Item | Result |
|---|---|
| The tile counts charges created in the window | ✅ The report route adds `chargedInWindow` from `buildChargedAiCostInWindow`, which runs **Finance's own** R-a read (`financeHealthDeps().ledger`) and the shared builder in `chargedAiCost.ts`, the same code F-K3 and Section 3 use. That is SA-1, "equal by construction". The new test proves the cost tile equals F-K3 with This month selected |
| Default This month | ✅ `{ from: <first of this UTC month>, to: today }` |
| Whole-periods label | ✅ On the period table |
| Deleted-accounts line | ✅ R-a includes deleted accounts (FIN SA-Q6), and the line comes from the same builder (`chargedAiCost.ts:94`) |

#### Pins (each move is the ruled one)

SA recomputed each file, LF-normalised, now against HEAD:

| Pin | Result |
|---|---|
| **Pin A** file | `3fa2360a` → `5f537869`. The diff is **exactly** the fixture's `chargedInWindow` line and the two `A2 CostsKpis` entries (`e22045d4` → `15439ff5`, `e8d692a0` → `6ee816e2`), as SA-PIN-MK2 ruled. The other 61 entries are unchanged |
| **Pin C** table | `02813360` → `64a565e9`. Only rows 1, 7, 9 and 10 move from `from=2026-09-17` to `from=2026-10-01` (the default window), with the ruling recorded in the file header. Leak requests are unchanged, and **the Pin C test file is unchanged** (`98ea0507`) |
| Unchanged | AC-173 `3a1a2dd4` and its helper `b84e0c96`; Pin B `a1b3db0c`; Pin D `1f7cf07a`; AC-145 `33340751` (the finance payload is untouched) |

The re-applied MK-2 row in SA-RR-MK's pin table, with Pin C and Pin A's two `CostsKpis` entries, matches.

#### Rulings

- **RU-19: approved.** The ledger importer guard matches any mention, type-only included, so `chargedAiCost.ts` (types only, like `aiCost.ts`) must be listed. Taking `financeHealthDeps().ledger` in the route, instead of importing the repository singleton, keeps **one wiring of R-a / R-a′**: the report route and Finance cannot read the ledger differently. That is the stronger form of SA-1.
- **Q-R1: a technical consistency ruling, not a business question.** The two rules differ for a reason, and that reason holds.
  - **F-K3 shows Unknown** on an unreadable amount, because it is a **trend tile**. Its colour compares this month with last month (BD-11 at 1.5× and 2×), and a lower bound cannot drive a ratio honestly.
  - **Section 3, the Charge checks tile and, in MK-3, A-K1** are **totals without a comparison**, so "at least X" is the honest form (AGG-3), as everywhere else on Money.
  - **Ruling for MK-3:** A-K1 keeps Section 3's rule ("at least"); it does not take F-K3's stricter one. The pages agree exactly whenever every amount is readable. When one is not, F-K3 says Unknown and A-K1 says "at least X". MK-3's tooltip or definition for A-K1 says so in one line.
  - No user question: the money definition is unchanged, and only a lower bound's display differs, for a stated technical reason.

#### Also checked

| Item | Result |
|---|---|
| Finance mode guard | ✅ `chargedAiCost.ts` names no mode (SA grep), and the finance source guard passes |
| ≤ 1,000 rows | ✅ R-a's existing keyset paging (`CHARGED_LEDGER_READ`, ≤ 1,000 per page, ceiling → "at least"). No new read, and the FF-1d range cap passes |
| Repositories only | ✅ Through Finance's existing wiring. The route's `accountId` is the already-validated report filter (Zod, platform refused) |
| Currency | ✅ AI cost is USD by definition (`cost_usd`, CUR-5), and nothing is summed across currencies |
| Tests | ✅ SA ran the finance guard, `chargedAiCost`, `financeHealth`, the credits routes, `app/admin/business-os-llm`, the ledger importer guard, FF-1d, Pin A, the Charge checks page and Pin C, and `app/admin/__tests__` (vocabulary, contrast, C-14): **3424 passed** |

## QA Testing Report

### QA — MK-2, 2026-10-26

Worktree `neuronforge-finance-health`, branch `feature/admin-money-mk2-one-ai-cost` on `6e19cbe4`, uncommitted. The source has been stable since 13:15, before every run below.

| | |
|---|---|
| **Test mode** | full |
| **Focus** | api, ui |
| **Skipped** | the live page (user, below) |
| **Input source** | prompt + workplan (scope, RU-1 to RU-19, SA-CR-MK2) |

**Strategy used:**
- **A + B:** every suite and guard, each run alone.
- **A code read:** `chargedAiCost.ts`, the Finance read change, the route, the tile, the block and the label.
- **A temporary, untracked probe, deleted afterwards** (`git status` is clean of `zz_*`; it is not kept as a permanent test):
  - Dev's T-1 cases use a ledger mock that returns the same rows **whatever range is asked**, so they cannot show a difference in what the two sides read. The probe uses a **range-aware ledger**: a fake R-a / R-a′ that really filters the seeded rows on `created_at` in `[from, to)`.
  - The seeded rows include:
    - deleted accounts (`user_id` null) in two months;
    - the platform account;
    - a correction row;
    - rows on each month boundary;
    - rows either side of the charging cut-over (`2026-09-29T16:50:53.914Z`).
  - Finance (`buildFinanceHealth`) and the route's own path (`windowInstants({from, to})` → `buildChargedAiCostInWindow`) then run on the same rows.
- A scoped tsc with a canary.

**Verdict: PASS. No bugs.** One informational note.

#### Behaviour

**1. The cost tile counts charges created in the window, defaults to This month, and equals F-K3 with This month.**

Probe on the range-aware ledger, `now` = 2026-11-09 12:00Z:

| Window | Tile | Section 3 | F-K3 (K-1) | Deleted line |
|---|---|---|---|---|
| **This month**, the route default `2026-11-01` to today | **8.25** | 8.25 | **8.25** | $4.50, 2 rows |
| Last month (custom Oct 1 to 31) | 24 | 24 | — | $16, 1 row |
| **Across the cut-over** (Sep 20 to Oct 20) | 80 | 80 (`starts_before_cutover`) | — | — |
| **Entirely before the cut-over** (Sep 1 to 28) | 0 | 0 | — | — |
| A single day | 4 | 4 | — | — |
| **One business picked**, This month | **1** | 1 | 1 | none |

How to read the table:
- **This month:** 8.25 is the month-start row plus the 6th and the 9th, including the deleted ones, net of the correction. The 31 Oct 23:59:59.999 row is out.
- **Across the cut-over:** the 64 after the cut-over plus the 16 deleted. The 32 before the cut-over is excluded on both sides.
- **One business picked:** the deleted figure is 0.
- **Each window:** the tile's coverage equals Section 3's, and `windowInstants` gives exactly Finance's `resolveFinanceWindow` instants.

The default is This month. `COSTS_DEFAULT_WINDOW = this_month`, and the route's no-dates default is `YYYY-MM-01` to today (RU-8). Render tests show "This month" pressed, and the tab "opens on This month".

**2. Whole-periods label and deleted-accounts line.**

The period table shows "Whole billing periods: can include charges from before the window" (`costs-whole-periods`).

The block "Charged AI cost in this window" shows:
- "Deleted accounts: $x (n ledger rows)" when deleted accounts hold charges;
- "No charges from deleted accounts" when they hold none;
- nothing when a business is picked.

Dev's render tests are green. The probe shows the deleted bucket is right: **$4.50 over 2 rows** this month, and **$16** for the October window. Deleted rows are inside the total, not added twice.

**3. Unreadable amount (Q-R1).**

Probe: one charge with the amount `not-a-number`.
- **The tile:** `status: 'partial'`, `unreadableAmounts: 1`, the same lower bound as Section 3 (8.25). The UI says "at least" on the tile and in the block (render test).
- **F-K3:** `k1.value` is null and its status `unavailable`, so it shows Unknown.

This is the intended split per SA Q-R1.

**4. One ledger read, paged at ≤ 1,000. The report route for its other callers.**
- One read function (`readChargedLedger`) and one window read (`readChargedWindow`) serve Finance's Section 3, K-1 and the tile. `CHARGED_LEDGER_READ = { pageSize: 1000, ceiling: 20000 }`, and `FINANCE_LIMITS` points at it with its values unchanged.
- The route makes **one** R-a or R-a′ call, through Finance's own `financeHealthDeps().ledger`. Dev's test "the read is the same call" shows the range and paging are identical.
- At the ceiling, both say partial.
- The FF-1d range-cap guard is green.
- The report route's only client is `CostsTab`. The response is the unchanged report plus `chargedInWindow` (`{ ...report, chargedInWindow }`). `buildCreditReport` has no other caller, and `DEFAULT_WINDOW_DAYS` is used nowhere else.
- 401, 403, 400 and 409 still make no read, R-a included (route test, RU-7).

**5. Pins: only the ruled moves.**

`git diff`, LF-normalised:

- **Pin A** `3fa2360a` → `5f537869`. The diff is exactly three lines:
  - `+ chargedInWindow: { status: 'ok', costUsd: 2.5 },`
  - `A2 CostsKpis` `e22045d4…` → `15439ff5…`
  - `A2 CostsKpis no sections` `e8d692a0…` → `6ee816e2…`
- **Pin C table** `02813360` → `64a565e9`:
  - Only rows **1, 7, 9 and 10** move, from `from=2026-09-17` to `from=2026-10-01`.
  - The header comment records the ruling.
  - Every leak literal is unchanged.
  - The Pin C test file `98ea0507` is unchanged.
- **Unchanged:** Pin B `a1b3db0c`, Pin D `1f7cf07a`, AC-173 `3a1a2dd4` / `b84e0c96`, and the finance `route.test.ts` file `5695dd93`, with **AC-145 `333407516ae0…2215`**.

**Guards.** All green:
- the finance mode guard (`finance.source.guard`, which scans `chargedAiCost.ts`);
- the range-cap guard;
- **RU-19's importer guard** (`BusinessOsCreditLedgerReadRepository.test.ts`, with `chargedAiCost.ts` listed as type-only);
- `test:bos-entitlements`;
- `test:authz-guard`.

#### Suite runs (each alone)

| Suite | Result |
|---|---|
| `app/admin/business-os-llm` | 17/17, **856/856** |
| `app/admin/finance` (Pin B, Pin C, AC-173) | 27/27, **920/920** |
| `app/admin/components` (Pin A, C-14) | 27/27, **907/907** |
| `lib/business-os/credits` | 33/33, **1018/1018** |
| `lib/business-os/finance` | 23/23, **2276/2276** |
| `lib/repositories` (range-cap, RU-19 importer guard) | 117/117, **2802/2802** |
| Credits and finance routes (AC-145) | 7/7, **258/258** (127 + 131) |
| Guards: finance source, range-cap, ledger importer, layout folder, `app/admin/__tests__` (vocabulary, contrast and the rest), finance app source, USD copy | 22/22, **2862/2862** |
| `npm run test:authz-guard` | 2/2, 203/203 |
| `npm run test:bos-entitlements` | 308/308, **9259/9259** |
| `npm run lint:hooks` | exit 0 |

All counts match Dev's re-run on `6e19cbe4`.

**Scoped tsc:**
- Scope: `app/admin/business-os-llm`, `app/admin/finance`, `app/admin/components`, the credits and finance routes, `lib/business-os/finance`, `lib/business-os/credits` and the ledger importer test. That is 520 app and lib files.
- The canary in `chargedAiCost.ts` gave `(140,7) TS2322`. The file was restored with `cp` and checked with `cmp` (identical).
- The clean run: **exit 0, 0 errors**.

#### Issues Found

- **Bugs:** none.
- **Performance:** none. The Charge checks request adds the bounded R-a read Finance already makes, run in parallel with the report (R-2).
- **Info (not a defect): a request-time race.**
  - **The cause:** F-K3 (K-1) reads `[month start, now)`, while the tile and Section 3 read This month to the **next UTC midnight**.
  - **The probe:** a charge created **after `now`** but before midnight is in the tile and Section 3 (108.25) but not in F-K3 (8.25).
  - **What it means:** the two pages can differ only by charges written between the moment each page was read. Reloading both shows the same figure. Nothing to fix; MK-3's A-K1 tooltip could say "as of the time read" if wanted.

#### User browser steps (signed in as an admin)

1. **Money → Finance → Charge checks** (`/admin/finance/charges`):
   - The window opens on **This month**.
   - The "Charged AI cost" tile shows a dollar figure.
   - Open **Finance** in another tab: F-K3 "Charged AI cost this month" shows the **same** figure.
2. On Charge checks, scroll to **"Charged AI cost in this window"**:
   - the sentence about charges created in the window;
   - the **deleted accounts** line, or "No charges from deleted accounts".
3. The period table has the line **"Whole billing periods: can include charges from before the window"**. Its totals may differ from the tile; that is expected.
4. Pick **Last 30 days** on Charge checks and the same custom window on Finance: Section 3's charged AI cost equals the tile.
5. Pick one business: the deleted-accounts line disappears, and the tile equals that business's Finance figure.

#### Final Status

- [x] All MK-2 scope items pass. Equality with Finance is shown on a range-aware ledger across six windows, with deleted accounts. Only the ruled pins moved. Every guard and suite is green, and tsc is clean. **Ready for RM.**
- [ ] Issues found

## Commit Info

- **Branch:** `feature/admin-money-mk2-one-ai-cost` (on main `6e19cbe4`, which had not moved at commit time; no merge needed)
- **Commit:** `5452be3c` feat(finance): one charged AI cost figure on Charge checks (MK-2)
- **Pins:** Pin A (RU-14, RU-15) and the Pin C table (RU-1) moved as ruled; AC-145 `33340751…`, Pin B, Pin D and AC-173 unchanged
- **Note:** `creditReport.ts` shows one deleted line and no insertion; that is the ruled RU-8 removal of `DEFAULT_WINDOW_DAYS`, not a truncation
- **PR:** [#516](https://github.com/AgentsPilot/neuronforge/pull/516), auto-merge on (merge commit, via the merge queue)

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-19 | Created | MK-2 workplan: code facts, reuse plan, ruled changes RU-1 to RU-13, tests, guards, risks |
| 2026-10-19 | SA pin ruling (SA-PIN-MK2) | MK-2 re-freezes the two Pin A CostsKpis entries once (fixture gains chargedInWindow; before and after hashes recorded); no fallback; the helper home in lib/business-os/finance is right, with no placement guard affected; the costsFilters default and costs-tab state tests are ruled edits |
| 2026-10-19 | Dev: MK-2 completed after SA-PIN-MK2 | Pin A two entries re-frozen (RU-14/15), remaining ruled updates (RU-16 to RU-18), importer guard + type-only module (RU-19, for SA), route takes Finance's wiring; tests T-1 to T-5 added; runs recorded |
| 2026-10-26 | Dev: rebased by hand onto `6e19cbe4` | 17 files unchanged on main copied back; `financeHealth.ts` edits re-applied; equality describe re-appended plus an F-K3 case; Pin A's two `CostsKpis` entries re-frozen against main's values; SA's MK-2 pin-table row re-applied. Open for SA: RU-19, Q-R1 |
| 2026-10-26 | SA code review | CODE APPROVED (SA-CR-MK2): equal by construction (Finance R-a wiring plus the shared builder); Pin A (2 entries) and Pin C table moves are exactly the ruled ones, all other pins unchanged; RU-19 approved; Q-R1 is a technical consistency ruling (A-K1 keeps the at-least rule, F-K3 stays Unknown as a trend tile), so no user question; 3424 passed |
