# Workplan: Money MK-1, Client payments name and block KPI headlines

> **Last Updated**: 2026-10-19

**Developer:** Dev
**Requirement:** [ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md) §12 MK-1 row, §3.2 (the Credits and Client payments rows), §3.3 LL-1 to LL-5, §5 (the two block KPI rows), §13 FC-1, SA-RR-MK (MK-1: no pin expected); FIN BD-1, BD-46
**Branch:** `feature/admin-money-mk1-names-block-kpis` (from main `0ca7ea6f`, MK-0 #474 merged)
**Date:** 2026-10-19
**Status:** Code Approved (SA-CR-MK1), QA passed; committed `12b34dcc`, PR [#475](https://github.com/AgentsPilot/neuronforge/pull/475) opened 2026-10-19, auto-merge on
**Path:** UI short path, about 1 day. The user said to run the MK slices back to back. No payload, route, read or migration change.

## Overview

On Finance → Overview, "Takings through the platform" becomes **"Client payments (the businesses' money, not ours)"** and moves to the **bottom** of the Overview. Two block KPIs become the headlines of their blocks, each with MK-0's `KpiIndicator` (leading):
- **Businesses taking client payments** on Client payments;
- **Accounts over allowance** on Credits, with K-2's far-over count as an amber chip.

Out of scope:
- the `$` display (MK-5);
- moving payment problems (MK-6);
- K-2 leaving the strip (MK-5; it stays for now).

---

## 1. Code facts (at `0ca7ea6f`)

| # | Fact | Where |
|---|---|---|
| CF-1 | The Overview order is Revenue, Takings, Accounts by plan, AI cost, Credits, History, Payment problems | `FinanceView.tsx:304-311` |
| CF-2 | The takings frame is `FinanceSection id="takings"` with `TAKINGS_TITLE` and a neutral "Not our revenue" chip in every state (SA-WR-17). "Businesses with takings" is a plain line in the body (`takings-businesses`) | `TakingsSection.tsx`, `financeCopy.ts:331-332`, `:368` |
| CF-3 | Credits shows `overAllowance` (`credits-over`) and `farOverAllowance` in a summary `dl`. The payload already carries both counts and `farOverAllowancePercent` | `CreditsSection.tsx:118-122`; `financeTypes.ts:775-808` |
| CF-4 | No block-KPI component exists; MK-0 exports `KpiIndicator` and `KPI_INDICATOR_WORDS` for block KPIs | `app/admin/components/layout/KpiStrip.tsx` |
| CF-5 | The vocabulary guard scans `financeCopy.ts` with a **minimum** text count, so adding text is safe. The contrast guard walks `app/admin/finance`. The C-14 Finance registry lists the page's frame files, not every component | guards |

## 2. The change

- **`financeCopy.ts`:**
  - `TAKINGS_TITLE` becomes `"Client payments (the businesses' money, not ours)"`.
  - The chip stays `"Not our revenue"` (BD-1, SA-WR-17). The title and the chip say the same truth in two places.
  - New constants: `BLOCK_KPI_CLIENT_PAYMENTS_LABEL` = "Businesses taking client payments", `BLOCK_KPI_OVER_ALLOWANCE_LABEL` = "Accounts over allowance", `BLOCK_KPI_FAR_OVER_CHIP(count, percent)`.
  - **One definition constant per KPI (LL-4)**, worded from §5:
    - `BLOCK_KPI_CLIENT_PAYMENTS_DEFINITION` = "Businesses with at least one client payment recorded in the window. Their clients' money, not ours.";
    - `BLOCK_KPI_OVER_ALLOWANCE_DEFINITION` = "Accounts whose credit use this period is above their allowance."
- **New `app/admin/finance/components/BlockKpi.tsx`:** the minimal block-KPI headline. It shows the label, the value (already formatted), MK-0's `KpiIndicator` in the corner, and an optional `StatusChip`. It is a `div role="group"` named "label, value", so it is not a landmark and not a button (A-9). It is finance-local, not a shared export, so it is not full cycle and C-14 is unchanged.
- **`TakingsSection.tsx`:** the body starts with the `BlockKpi` "Businesses taking client payments", whose value is the existing `count(f.businesses)` (with "at least" when the payments read was cut off). It replaces the old "Businesses with takings" line. `testId="takings-businesses"` stays on the headline.
- **`CreditsSection.tsx`:** the body starts with the `BlockKpi` "Accounts over allowance", whose value is `f.overAllowance` (testId `credits-over` moves onto it). An amber (`warn`) chip appears when `farOverAllowance > 0`. The summary `dl` keeps far-over, gifted and bought, and drops the now-headlined over-allowance cell.
- **`FinanceView.tsx`:** `TakingsSection` moves after `PaymentProblemsSection`, the last section on the Overview. The order comment is updated.

## 3. Tests

| Test | Edit |
|---|---|
| `financePage.render.test.tsx` "sits directly under Our revenue…" | **Ruled edit:** the order is now payment problems, then client payments, last; the title assertion uses the new constant |
| New `app/admin/finance/__tests__/blockKpis.render.test.tsx` | Covers:<ul><li>both headlines, their names and values, and the leading icon's accessible name built from the one definition constant;</li><li>the "at least" value when cut off;</li><li>the far-over chip shown at > 0 and hidden at 0 or null;</li><li>client payments last on the Overview;</li><li>the title and the "Not our revenue" chip together;</li><li>no "Cost", "Expenses", "OPEX" or "Profit" in the new strings (FC-1)</li></ul> |
| Pins A to D, AC-173, AC-145 | Not edited; re-hashed at handover. Pin B renders tiles only, and the payload is unchanged |

## 4. Guards

- Vocabulary (minimum count), contrast (`text-slate-400` and up only), C-14 / layout, `lint:hooks`, `test:authz-guard`, `test:bos-entitlements`.
- The finance source guard: no mode wording, no money added together, every string from `financeCopy.ts`.

## 5. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | A test or guard asserts the old order or the old title | Found by grep: one order test (ruled edit); title assertions use the constant |
| R-2 | The headline and the K-2 tile show related counts | Expected until MK-5 removes K-2 from the strip |
| R-3 | A pin moves | Stop and report to SA (SA-RR-MK) |

## Implementation Notes

**2026-10-19, Dev. Implemented as §2, uncommitted. The payload is unchanged and no pin moved.**

| File | Change |
|---|---|
| `app/admin/finance/financeCopy.ts` | `TAKINGS_TITLE` is now `"Client payments (the businesses' money, not ours)"`. Five new constants: the two block KPI labels, their two definitions (LL-4, worded from §5), and `BLOCK_KPI_FAR_OVER_CHIP(count, percent)`. The "Not our revenue" chip is unchanged |
| `app/admin/finance/components/BlockKpi.tsx` | New: `div role="group"` named "label, value", MK-0's `KpiIndicator` in the corner, and an optional `StatusChip` |
| `app/admin/finance/components/TakingsSection.tsx` | The block KPI "Businesses taking client payments" (leading) heads the body, with `count(f.businesses)`, "at least" included. The old "Businesses with takings" line is removed, and the `takings-businesses` test id moves onto the headline value |
| `app/admin/finance/components/CreditsSection.tsx` | The block KPI "Accounts over allowance" (leading) heads the body. K-2's far-over count is an amber (`warn`) chip when > 0. The summary `dl` drops the headlined cell (grid 3/4 → 2/3 columns); the `credits-over` test id moves onto the headline value |
| `app/admin/finance/components/FinanceView.tsx` | `TakingsSection` moves after `PaymentProblemsSection`, the last section on the Overview. Order comment updated |
| `app/admin/finance/__tests__/financePage.render.test.tsx` | Three ruled edits and 7 new tests (the "Money MK-1" describe). See below |

**Ruled test edits** (UI short path; no pin):
1. The takings order test: it now asserts revenue → accounts → credits → payment problems → client payments, with client payments the last child, and the new title.
2. SA-WR-17 "no chip": Credits may now carry exactly one chip, `credits-over-chip`, tone `warn`. Accounts and AI cost still have none, and there is no frame badge on any of the three.
3. L-32: payment problems is now followed by client payments (retitled).

**D-1:** the workplan planned a separate `blockKpis.render.test.tsx`. The tests live in `financePage.render.test.tsx` instead, to reuse its payload fixtures and serve mock rather than copy them.

**SA-CR-MK1 C-1 (Low), fixed by Dev.** `CREDITS_OVER` (it duplicated `BLOCK_KPI_OVER_ALLOWANCE_LABEL`) and `TAKINGS_BUSINESSES` (unused) are deleted from `financeCopy.ts`, so each block KPI has one label constant (LL-4). A grep of `app`, `lib` and `components` beforehand found no other importer. Re-run: `app/admin/finance` plus the vocabulary guard, 21 suites, 880 passed (698 + 182).

**Honesty (BD-1):** the title says "not ours" and the neutral "Not our revenue" chip stays in every state. The block is not inside the revenue panel (tested). FC-1: no new string says just Cost, Expenses, OPEX or Profit (tested).

**`console.*`:** 0 in all five touched source files.

**Runs:**

| Run | Result |
|---|---|
| `app/admin/finance` | 20 suites, 698 passed (Pin B, AC-173 and the page tests included) |
| `app/admin/components` | 26 suites, 846 passed (Pin A included) |
| Vocabulary guard | 182 passed |
| Contrast and layout (C-14) guards | 2 suites, 480 passed, with no guard edit |
| Finance source guard | 1165 passed |
| `test:authz-guard` | 2 suites, 203 passed |
| `test:bos-entitlements` | 297 suites, 8998 passed |
| `lint:hooks` | exit 0 |
| ESLint on the five source files | clean |
| Scoped tsc with a canary | TS2322 at `BlockKpi.tsx(51,7)`. Restored byte-identical (sha256 `3ea174a3…57f9`), and the clean run had 0 errors in scope |
| Full `npm test` | 1591 suites (1563 passed, 20 failed, 8 skipped) and 40,413 tests (40,208 passed, 140 failed, 65 skipped). The failing set is **identical** to the R4 / MK-0 Windows baseline: the same 20 suites and the same 140 tests |

**Pins** (HEAD blob plus `git diff --quiet`): all seven are unchanged.
- AC-173 `3a1a2dd4…`
- helper `b84e0c96…`
- A `30f5fc24…`
- B `24ff0da7…`
- C `98ea0507…`
- helper `02813360…`
- D `1f7cf07a…`

`route.test.ts` (AC-145) is unchanged too.


## SA Review Notes

### SA Code Review (MK-1)

**Code Review by SA, 2026-10-19. Reviewed: the uncommitted tree on `feature/admin-money-mk1-names-block-kpis` (from main `0ca7ea6f`).**
**Status: Code Approved with one small condition (SA-CR-MK1).**

| Item | Result |
|---|---|
| Scope (my MK-1 ruling) | ✅ Markup and copy only. `app/api/admin/business-os/finance/**` is untouched (`git diff --quiet`), so the payload and **AC-145 are unchanged**. SA recomputed the pins: `3a1a2dd4` `b84e0c96` `30f5fc24` `24ff0da7` `98ea0507` `02813360` `1f7cf07a`, so **Pin B did not move**. No stop was needed |
| Rename and move (BD-1) | ✅ `TAKINGS_TITLE` reads "Client payments (the businesses' money, not ours)", the block renders last on the Overview, and the "Not our revenue" chip is kept |
| Block KPIs (§5) | ✅ "Businesses taking client payments" (`f.businesses`) and "Accounts over allowance" (`f.overAllowance`) are the headlines, each with the **leading** `KpiIndicator` (MK-0). K-2's far-over count is an amber chip, only when above 0, with the configured % from the payload (`farOverAllowancePercent`) |
| Copy (FC-1, LL-4) | ✅ FC-1: each figure is named for what it counts, with no bare "Cost" or "Expenses". LL-4: one label constant and one definition constant per block KPI, in `financeCopy.ts`. **See C-1 for the leftovers** |
| The 3 edited page tests | ✅ **Not frozen pins.** They are ordinary `financePage.render.test.tsx` cases, and each edit follows the approved change: (1) takings no longer sits under "Our revenue", so the order assertion moves it to last; (2) "Accounts, AI cost and Credits render no chip" no longer holds for Credits, which now has the amber block chip; (3) payment problems is no longer the last block. The 7 added cases cover the new KPIs, the icon and the chip |
| Guards | ✅ The vocabulary guard needs no edit, and neither do contrast or C-14 / nav. SA ran the 17 suites related to the changed files plus `app/admin/__tests__` and `app/admin/components`: **59 suites, 3468 passed** |
| Windows-only failure set | ✅ None of the 20 known Windows-only suites is in the related-test set for these files (all 17 green), so the set is unchanged |

**Condition C-1 (Low, before the RM commit).** Two copy constants are now dead and one duplicates the new one: `CREDITS_OVER = 'Accounts over allowance'` (`financeCopy.ts:285`), which is identical to `BLOCK_KPI_OVER_ALLOWANCE_LABEL`, and `TAKINGS_BUSINESSES` (`:385`). Neither has a caller left. Delete both, or make `BLOCK_KPI_OVER_ALLOWANCE_LABEL` reuse `CREDITS_OVER`, so LL-4's "one copy constant" holds and there is no dead code. Then re-run the vocabulary guard, whose text-count floor must still pass.

**Ruling: BlockKpi placement.** Keep it **Finance-local in MK-1**: today it has one user page, and a shared export now would be premature. **MK-3 promotes it** to `app/admin/components/layout/BlockKpi.tsx` when the AI cost page needs "Businesses with uncharged calls". That move runs the full cycle as a shared export (LAY R-7) and updates the Finance imports in the same PR. The AI cost page must **not** import it from `app/admin/finance/` (no cross-page import).

**For MK-5 (not MK-1):** when K-2 leaves the strip, the block chip's amber must come from the K-2 rule data (`FINANCE_RULES`), not from the fixed `tone: 'warn'`, so BD-11 stays data-driven.

#### Code Approved for QA: Yes, after C-1

## QA Testing Report

**QA — 2026-10-19** (worktree `neuronforge-finance-m8`, branch `feature/admin-money-mk1-names-block-kpis` on `0ca7ea6f`, uncommitted; **after SA's C-1**: `CREDITS_OVER` and `TAKINGS_BUSINESSES` are gone, and only the used `TAKINGS_BUSINESSES_COLUMN` remains)
**Test mode:** full
**Strategy used:**
- **A:** Jest suites and guards, run one at a time.
- A code read of the copy, `BlockKpi`, `CreditsSection`, `TakingsSection`, `FinanceView` and the K-2 rule.
- A scoped tsc with a canary.

**Focus:** ui
**Skipped:** the live browser look (user, below).
**Input source:** prompt + workplan

**Verdict: PASS. No bugs.**

### Behaviour

| Item | Result | Evidence |
|---|---|---|
| The block is retitled "Client payments (the businesses' money, not ours)", is last, and keeps the "Not our revenue" chip | ✅ | `TAKINGS_TITLE`. `FinanceView` renders `TakingsSection` after `PaymentProblemsSection`. Tests "sits last on the Overview…" and "BD-1: the title and the 'Not our revenue' chip say it together; the block is never inside the revenue panel" |
| Headline "Businesses taking client payments": the count, the leading icon and the two-line tooltip | ✅ | `BlockKpi` with `count(f.businesses)` ("at least" when cut off, tested). The icon is MK-0's `KpiIndicator` (leading). Its accessible name is built from `BLOCK_KPI_CLIENT_PAYMENTS_DEFINITION` (tested). The tooltip's two lines (definition, then "Leading indicator: it tells you early what is coming") are the shared component QA verified in MK-0 |
| Credits headline "Accounts over allowance" with the leading icon; the amber far-over chip at ≥ 150% only | ✅ | Chip `tone: 'warn'` only when `farOverAllowance > 0` (`CreditsSection.tsx:128`). The count comes from K-2's rule, `used × 100 >= allowance × 150` (`creditsSection.ts:322`, `FINANCE_METRIC_PARAMS.farOverAllowancePercent = 150`), so **at or above** 150%. The chip reads "N at or over 150% of allowance". Tests: chip shown when > 0; `it.each([[0], [null]])` no chip |
| K-2 tile still in the strip | ✅ | `FinanceKpiStrip.tsx` untouched; Pin B (the 5 tiles) unchanged and green |
| No bare "Cost", "Expenses", "OPEX" or "Profit" | ✅ | test FC-1; QA scan of the added string literals: none |
| Payload unchanged | ✅ | `app/api` and `lib` are `git diff --quiet`; the finance route suite 122/122; the AC-145 hash `39b35743…56ea` is present and green |

### Suite runs (each alone)

| Suite | Result |
|---|---|
| `app/admin/finance` (Pin B, AC-173, page tests incl. the 7 MK-1 cases) | 20/20, 698/698 |
| `app/admin/components` (Pin A) | 26/26, 846/846 |
| Vocabulary + contrast + layout (C-14) guards | 3/3, 662/662 (= 182 + 480); unedited |
| The finance route (AC-145) | 2/2, 122/122 |
| `npm run test:authz-guard` | 2/2, 203/203 |
| `npm run test:bos-entitlements` | 297/297, 8998/8998 |
| `npm run lint:hooks` | exit 0 |
| Re-run after C-1: `app/admin/finance` + vocabulary | 21/21, 880/880 |

These match Dev's counts.

**Scoped tsc:**
- Config in the scratchpad covering `BlockKpi`, `CreditsSection`, `TakingsSection`, `FinanceView`, `financeCopy`, the page test, Pin B and AC-173.
- A canary in `BlockKpi.tsx` gave `(51,7) TS2322`.
- The file was restored with `cp` and checked with `cmp` (identical).
- The clean run gives **exit 0, 0 errors**.

**Pins (LF-normalised):** `3a1a2dd4` `b84e0c96` `30f5fc24` `24ff0da7` `98ea0507` `02813360` `1f7cf07a`, all unchanged. AC-145 is unchanged.

### Issues Found
- **Bugs:** none.
- **Notes (for MK-5):** as SA ruled, the block chip's amber must come from the K-2 rule data once K-2 leaves the strip. MK-0's QA-MK0-N1 (Escape inside a drawer) does not apply here: the block KPIs sit on the page, not in a drawer.

### User browser steps (after merge; signed in as an admin)
1. **Money → Finance**, Overview, all businesses. Scroll to the bottom: the **last** block is "Client payments (the businesses' money, not ours)" with the "Not our revenue" chip.
2. Its headline reads "Businesses taking client payments" with a count and a small arrow icon. Hover or Tab to the icon. The tooltip shows "Businesses with at least one client payment recorded in the window. Their clients' money, not ours." and "Leading indicator: it tells you early what is coming". Escape closes it.
3. In **Credits**, the headline reads "Accounts over allowance" with its count and the arrow icon. An amber chip "N at or over 150% of allowance" appears only if an account is that far over.
4. The KPI strip at the top still shows the "Accounts far over allowance" tile (until MK-5).
5. No label reads just "Cost", "Expenses", "OPEX" or "Profit".

### Final Status
- [x] MK-1 meets its criteria after C-1. No bugs. **Ready for RM.**
- [ ] Issues found

## Commit Info

- **Branch:** `feature/admin-money-mk1-names-block-kpis` (from main `0ca7ea6f`)
- **Commit:** `12b34dcc` feat(finance): Client payments renamed and moved last, block KPI headlines with indicators (MK-1)
- **PR:** [#475](https://github.com/AgentsPilot/neuronforge/pull/475), auto-merge on (merge commit, via the merge queue)
- **Files:** `app/admin/finance/components/{BlockKpi,TakingsSection,CreditsSection,FinanceView}.tsx`, `app/admin/finance/financeCopy.ts`, `app/admin/finance/__tests__/financePage.render.test.tsx`, this workplan, the retrospective

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-19 | Created and implemented (Dev) | Client payments renamed and moved last; two block KPI headlines with the MK-0 indicator |
| 2026-10-19 | SA code review | Code Approved with C-1 (SA-CR-MK1): delete the dead CREDITS_OVER and TAKINGS_BUSINESSES (LL-4). BlockKpi stays Finance-local; MK-3 promotes it to the shared layout folder (R-7). Pins and AC-145 unchanged; guards green |
