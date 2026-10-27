# Workplan: Finance follow-ups bundle (MK2-FU-1, MK9-FU-1, MK9-FU-3, MK3A-FU-1, R4-FU-1, FF-3, CPU1A-FU-1)

> **Last Updated**: 2026-10-27

**Developer:** Dev
**Branch:** `chore/finance-followups-bundle`, worktree `neuronforge-finfu`, from `origin/main` `b7f02cd6` (the #527 merge)
**Requirement sources:** [ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md), [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) §0.4, and the retrospectives quoted under each item
**Date:** 2026-10-27
**Status:** Code Complete (uncommitted; SA-WP-FU approved with FU-C1 to FU-C7; awaiting SA code review and QA)

## Overview

The user approved this bundle on 2026-10-27. It holds seven small follow-ups from the Money KPI restructure, Finance R4, Finance FF-1 and client payments USD 1a. It ships as **one commit and one PR**. Every item is traced to its source and quoted word for word.

Three of the items differ from the brief once checked against the code. They are listed here so SA and the user see them first:

1. **Item 9 (R4-FU-1), as written in its source, removes no runtime read.** The two repository methods it names have had no caller since R4. The deps keys of the same name are still wired, to the current-mode reader, and still run. On its own, R4-FU-1 deletes dead code and gives no faster page. Step 0 did find one read that matches the brief's wording, "still run but no longer shown": **R-d** (`countRevenueRows`). Its only output, `revenue.state`, reaches the page only as a `data-state` attribute. Removing it is proposed under SA-Q-FU-3.
2. **Item 10 (FF-3) is not about 3 days of work.** All 14 entries sit outside Finance. Three of them (BizQL compiler ×2, purge ×1) are already the separate tasks B-1 and B-2. A tranche is proposed below, with the rest deferred.
3. **Item 2 (MK2-FU-1) can make the two tiles one computation, but it cannot freeze time.** Two pages loaded at different moments can still differ by a charge made between the loads. See BQ-FU-1.

## Table of Contents

- [Analysis Summary](#analysis-summary)
- [Item 2: MK2-FU-1, one charged AI cost figure for This month](#item-2-mk2-fu-1-one-charged-ai-cost-figure-for-this-month)
- [Item 3: MK9-FU-1, one "Paid: Unknown"](#item-3-mk9-fu-1-one-paid-unknown)
- [Item 5: MK9-FU-3, the Comped comment](#item-5-mk9-fu-3-the-comped-comment)
- [Item 6: MK3A-FU-1, an exact two-way type check](#item-6-mk3a-fu-1-an-exact-two-way-type-check)
- [Item 9: R4-FU-1, remove the unwired and unshown finance reads](#item-9-r4-fu-1-remove-the-unwired-and-unshown-finance-reads)
- [Item 10: FF-3, range-cap allow-list burn-down](#item-10-ff-3-range-cap-allow-list-burn-down)
- [Item 11: CPU1A-FU-1, the leak guard's function-parameter form](#item-11-cpu1a-fu-1-the-leak-guards-function-parameter-form)
- [Files to Create / Modify](#files-to-create--modify)
- [Overlap with slice 1b](#overlap-with-slice-1b)
- [Pin and baseline moves](#pin-and-baseline-moves)
- [Acceptance criteria](#acceptance-criteria)
- [Estimate](#estimate)
- [Risks](#risks)
- [SA questions](#sa-questions)
- [Business questions (separate)](#business-questions-separate)
- [Task List](#task-list)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## Analysis Summary

| User # | Id | Touches | DB / route / migration |
|---|---|---|---|
| 2 | MK2-FU-1 | `lib/business-os/finance/financeWindow.ts` (`k1Spans`), `financeHealth.ts` (K-1 read wiring) | No migration. No route schema change. One read fewer on the This month view |
| 3 | MK9-FU-1 | `app/admin/finance/components/PayingBreakdownSection.tsx`, `app/admin/finance/financeCopy.ts` (`PAYING_BREAKDOWN`) | UI only. Payload unchanged |
| 5 | MK9-FU-3 | `lib/business-os/finance/payingBreakdown.ts` (one comment) | None |
| 6 | MK3A-FU-1 | two `*.wireTypes.test.ts` files | Test-only (compile-time gate) |
| 9 | R4-FU-1 (+ R-d) | `BusinessOsFinanceReadRepository.ts`, `financeHealth.ts`, `financeHealthDeps.ts`, `financeTypes.ts`, `RevenuePanel.tsx`, `lib/repositories/index.ts`, the finance route's doc comment, tests | No migration. Payload loses `revenue.state` (if SA-Q-FU-3 is approved) |
| 10 | FF-3 (tranche A) | `AuditTrailRepository.ts`, `SmartLinkRepository.ts`, `InsightRepository.ts`, `rangeCap.source.guard.test.ts` | No migration. Paged reads, ≤1,000 rows a page |
| 11 | CPU1A-FU-1 | `lib/admin/exchangeRates/__tests__/clientPaymentsUsd.source.guard.test.ts` | Test-only |

Unchanged throughout: `requireAdmin` first in every route (no route handler is edited), the Finance livemode guard, CUR-3, and the repositories-only rule. No new repository method is added (tranche A only re-pages existing methods). Nothing is imported from `lib/business-os/entitlements/`, so the entitlements skill does not apply. `npm run test:bos-entitlements` will still be run before hand-over, as a check.

**`console.*` in touched files:** none. Every production file in the table was checked and has 0 `console.*` calls.

**Branch note for TL:** the Dev role says RM creates branches. This branch and worktree were created by Dev because the TL brief said to. Please ask RM to confirm the branch name when it takes over.

---

## Item 2: MK2-FU-1, one charged AI cost figure for This month

### Source

[ADMIN_MONEY_MK2_RETROSPECTIVE.md](/docs/retrospectives/ADMIN_MONEY_MK2_RETROSPECTIVE.md) line 35:

> "**Follow-up MK2-FU-1 (a QA note, not a defect):** F-K3 counts up to now, while the tile counts up to midnight. A charge made between two page loads can make them differ until both are reloaded."

The related SA ruling ([ADMIN_MONEY_MK2_ONE_AI_COST_WORKPLAN.md](/docs/workplans/ADMIN_MONEY_MK2_ONE_AI_COST_WORKPLAN.md) line 441):

> "Q-R1 is a technical consistency ruling (A-K1 keeps the at-least rule, F-K3 stays Unknown as a trend tile), so no user question"

### Step 0 facts

| Fact | Where |
|---|---|
| F-K3 (K-1) reads `k1Spans(now).current = { from: month start, to: now }`, whatever window is picked | `lib/business-os/finance/financeWindow.ts:84-97`; read at `financeHealth.ts:707` (`readSpan(spans.current)`) |
| Section 3 on Finance, and A-K1 on the AI cost page, read the picked window `[start, end)`. For This month, `end` is the **next UTC midnight** (`windowInstants`: `to + 1 day`) | `lib/business-os/credits/creditReport.ts:126-130`; Finance `financeHealth.ts:706` (`readChargedWindow`); AI cost route `app/api/admin/business-os/credits/report/route.ts:165-174` |
| A-K1 = Section 3 by construction (one read function, one builder) | `lib/business-os/finance/chargedAiCost.ts` |
| So on one Finance load with This month picked, the **same ledger is read twice**: `[Oct 1, Oct 15)` for Section 3 and `[Oct 1, now)` for F-K3. AC-145 pins both calls | `app/api/admin/business-os/finance/__tests__/route.test.ts:1294-1297` |
| The K-1 previous span is "the same elapsed time last month", `previousStart + min(elapsed, previousLength)` | `financeWindow.ts:94`, requirement §7.1 K-1 row ("current UTC month to date ... same elapsed span of the previous month") |
| A ledger row cannot be dated after the read (created by the database at insert time). So `[month start, now)` and `[month start, next midnight)` hold the same rows, apart from clock skew between the app server and the database, and a row inserted while the two reads run | — |
| F-K3 and A-K1 already differ by ruling on an unreadable amount: F-K3 shows Unknown (`k1Measured` returns null), A-K1 shows "at least" (Q-R1) | `financeHealth.ts:1431-1435` |

### Which side changes, and why

**F-K3 changes. A-K1 does not.**

- A-K1 is a window figure. It must equal Section 3 for every window: Today, 7 d, 30 d, This month, 90 d and Custom. Its request is pinned by T-12 and Pin C. Moving its end to "now" would break Section 3 = A-K1 for every window, to fix one.
- F-K3 is a trend tile (SA, Q-R1). What makes the trend fair is the **previous** span, "the same elapsed time last month". That is untouched. The current span's end can move from `now` to the next UTC midnight without changing what it counts. No row exists after `now`, and the requirement's wording, "month to date", still holds.

### Fix

1. `k1Spans(now).current.to` becomes the next UTC midnight, the same instant `windowInstants` gives This month's end. `previous` is unchanged.
2. **Reuse (SA-Q-FU-1 default):** in `buildFinanceHealth`, when the clamped window read covers exactly `spans.current` (`clamp.readFrom === spans.current.from` and `window.end === spans.current.to`), K-1's current figure uses the **same promise** as Section 3 (`windowResult`). No second read is made. On any other window, K-1 still makes its own read, now ending at the next midnight.
3. `k1Measured` stays as it is: Unknown on an unreadable amount (Q-R1), and "minimum" when the read hit its ceiling.

**Result:** with This month picked, F-K3, Section 3 and A-K1 come from the same rows through one definition. Within one Finance load they come from one read. The only difference left is a charge made between two separate page loads (BQ-FU-1).

### Tests

- `financeWindow.test.ts`: `current.to` is the next UTC midnight in every existing case. Month-start case: `current` is no longer empty (`[Dec 1, Dec 2)`), and `previous` is still empty. The "previous" assertions are unchanged.
- `financeHealth.test.ts`, a new describe. Per the MK-2 lesson, it uses a **fake ledger that filters by `[from, to)`**, not one that ignores the window:
  - This month: exactly **one** all-accounts ledger call. F-K3's value equals Section 3's total. A row dated later today is counted by both. A row dated next month is counted by neither.
  - The same with a business picked (one account-scoped call).
  - 7 d window: two calls (Section 3's and K-1's own). K-1's call ends at the next midnight.
  - Unreadable amount: F-K3 Unknown, Section 3 "at least" (Q-R1 stays pinned).
- `route.test.ts` AC-145: see [Pin and baseline moves](#pin-and-baseline-moves).

---

## Item 3: MK9-FU-1, one "Paid: Unknown"

### Source

[ADMIN_MONEY_MK9_RETROSPECTIVE.md](/docs/retrospectives/ADMIN_MONEY_MK9_RETROSPECTIVE.md) line 35:

> "MK9-FU-1: "Paid: Unknown" is shown twice."

### Step 0 facts

The two places are **not** "Paid" and "Paid before the trial ended", as the brief says. When the first-payment result is missing (`trials.paid === null`, read failed or did not run), `app/admin/finance/components/PayingBreakdownSection.tsx` shows:

| Line | Code | Shows |
|---|---|---|
| Trials line (`paying-breakdown-trials-line`), lines 90-93 | `trials.paid === null \|\| trials.paidBeforeEnd === null ? PAYING_BREAKDOWN.paidUnknown : …` | "Trials ended in this window: 4 · **Paid: Unknown**" (one string covers both Paid and "of which before the trial ended") |
| Rate line (`paying-breakdown-rate`), lines 95-102 | `… : trials.paid === null ? PAYING_BREAKDOWN.paidUnknown : …` | "**Paid: Unknown**" again |

The text is `PAYING_BREAKDOWN.paidUnknown = 'Paid: Unknown'` (`app/admin/finance/financeCopy.ts:873`). The builder makes `paid` and `paidBeforeEnd` null together (`lib/business-os/finance/payingBreakdown.ts`, `paidKnown`), so the trials line's `||` never splits them.

### Fix

- The trials line keeps the one Unknown, with one short reason: `PAYING_BREAKDOWN.paidUnknown` becomes `'Paid: Unknown (first payments could not be read)'`. That is one key value changed, no new key.
- The rate line is **not rendered** when `trials.paid === null` and the walk is exact (SA-Q-FU-9). A rate cannot exist without Paid, and the reason is already on the line above. The cut-off branch (`noRateCutOff`) and the too-few branch are unchanged.
- No payload change. No colour change. The section status is unchanged.

### Tests

The existing MK-9 render test file (`app/admin/finance/__tests__/…payingBreakdown…render.test.tsx`; the exact name is fixed at implementation) gets:

- paid unknown: `getAllByText(/Paid: Unknown/)` has length **1**, the reason is present, and `paying-breakdown-rate` is absent;
- paid known, too few trials: the rate line is still there (control);
- cut-off: still `noRateCutOff` (control).

Any existing assertion on the old string is a ruled test edit (copy only).

---

## Item 5: MK9-FU-3, the Comped comment

### Source

[ADMIN_MONEY_MK9_RETROSPECTIVE.md](/docs/retrospectives/ADMIN_MONEY_MK9_RETROSPECTIVE.md) line 37:

> "MK9-FU-3: a comment claims a paying account in Comped "is not hidden", but the builder cannot produce that case. Correct or remove the comment."

### Step 0 facts

- The comment is at `lib/business-os/finance/payingBreakdown.ts:58`: `// Comped means not paying already; a paying row here would be a classifier fault, so it is not hidden.`
- Why the case cannot happen: `groupFor` returns `'comped'` only when `isPaying` is `false` (`lib/business-os/finance/planGroups.ts:64`). `isPaying` comes from `payingSetOf` with `isPayingBillingRow` (`financeHealth.ts:605-617`). `compedSplit` is called with the same `isPayingBillingRow` (`financeHealth.ts:1525`), so a row in Comped is never paying.
- The comment is also wrong in the other direction. If the case ever happened, the account would be counted in `total` but in **neither** sub-line, so it **would** be hidden from both parts.

### Fix

The comment is replaced. It is internal only, so there is no logic or test change:

```typescript
// Unreachable: an account is Comped only when the classifier found it NOT paying, by this same
// isPaying predicate (planGroups.groupFor). Were it reached, the account would count in `total`
// but in neither line, so the two lines would no longer add up to Comped.
```

### Tests

None new. The existing `payingBreakdown.test.ts` case "every comped account lands in exactly one part, and the two add up to Comped" already pins the invariant.

---

## Item 6: MK3A-FU-1, an exact two-way type check

### Source

[ADMIN_MONEY_MK3A_RETROSPECTIVE.md](/docs/retrospectives/ADMIN_MONEY_MK3A_RETROSPECTIVE.md) line 44:

> "MK3A-FU-1 (SA Low-2): the two-way type check misses an optional field. This is the existing pattern."

SA's own note ([ADMIN_MONEY_MK3_AI_COST_PAGE_WORKPLAN.md](/docs/workplans/ADMIN_MONEY_MK3_AI_COST_PAGE_WORKPLAN.md) line 799):

> "`recordedInWindow.wireTypes.test.ts`: the two-way `Satisfies` check catches a required field added on either side. It does not catch an OPTIONAL field added on one side. This matches the existing `creditReport.wireTypes` pattern, so it is not a regression. If a tighter check is wanted later, use an exact `Equals<A, B>` helper for both pins together."

### Step 0 facts

- `lib/business-os/finance/__tests__/recordedInWindow.wireTypes.test.ts` pins `CreditReportRecordedInWindow` against `FinanceRecordedAiCost` with `Satisfies<Expected, Actual extends Expected>` both ways.
- `lib/business-os/credits/__tests__/creditReport.wireTypes.test.ts` pins `CostReportPayload` (client) against `CreditReportResponse` (server) the same way.
- Both are compiled by `npm run typecheck:bos-llm` (`scripts/typecheck-bos-llm.ts` SCOPED_DIRS, lines 110 and 121), which CI runs (`.github/workflows/bos-llm-typecheck.yml:123`). Jest does not check types.
- 7 other `*.wireTypes.test.ts` files use the same `Satisfies` pattern. They are listed under SA-Q-FU-5.
- **Probe, run and then deleted (2026-10-27, `tsc` on a temporary file in the worktree):**
  - A plain `Equals<CostReportPayload, CreditReportResponse>` gives **false** today. The server side is an intersection, and the plain helper treats `A & B` and the flattened object as different.
  - With a deep normaliser `Norm<T>` (an identity mapped type, applied recursively, functions left alone), both real pairs are **equal**.
  - Two planted controls fail as wanted: an optional field on one side at the top level, and one nested a level down.

### Fix

In **both** files, keep the two `Satisfies` aliases. They give the clearer message on a required-field drift. Add, locally in each file (the existing pattern declares its helper locally, so this adds no shared module):

```typescript
/** Exact equality, optional and readonly modifiers included (SA Low-2 / MK3A-FU-1). */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
/** Flattens intersections at every depth, so `A & B` equals the same object written out. */
type Norm<T> = T extends (...args: never[]) => unknown ? T : T extends object ? { [K in keyof T]: Norm<T[K]> } : T;
type Expect<T extends true> = T;

type Exact = Expect<Equals<Norm<Wire>, Norm<Finance>>>;
// Planted controls: the compile fails (TS2578, unused directive) if the helper ever stops biting.
// @ts-expect-error an optional field on one side only must not be equal
type ControlTop = Expect<Equals<Norm<Finance>, Norm<Finance & { extra?: number }>>>;
// @ts-expect-error a nested one-sided optional field must not be equal
type ControlNested = Expect<Equals<Norm<{ a: { b: number } }>, Norm<{ a: { b: number; c?: string } }>>>;
```

The runtime bodies stay trivial and reference the new aliases, so `noUnusedLocals` does not complain.

### Tests

- `npm run typecheck:bos-llm` is clean with no baseline change.
- **Planted proof, recorded in the QA report and not committed:** add `extra?: number` to `CreditReportRecordedInWindow`. The gate fails with TS2344 on `Exact`. Today's `Satisfies` pair passes the same change, which proves the gap is closed. Repeat once on `CostReportPayload`.

---

## Item 9: R4-FU-1, remove the unwired and unshown finance reads

### Source

[BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) §0.4, line 318:

> "| R4-FU-1 | **Next Finance follow-up: remove the unwired R-c and R-c′** (`listBillingStatusesAllAccounts`, `findBillingStatusForAccount`) from `BusinessOsFinanceReadRepository`, with their tests | Since R4 (BD-37) nothing calls them; they stay only because `FinanceHealthDeps['finance']` is a `Pick` of the repository. Removal moves that type, and touches the finance table pin, the billing-table reader list and possibly the AC-145 named reads (pins), so it needs its own SA-reviewed slice | 2026-10-18 |"

[BUSINESS_OS_FINANCE_HEALTH_R4_RETROSPECTIVE.md](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_R4_RETROSPECTIVE.md) line 32:

> "**Follow-up R4-FU-1:** remove the reads that are no longer wired."

### Step 0 facts, part A: the two dead repository methods

| Fact | Where |
|---|---|
| `BusinessOsFinanceReadRepository.listBillingStatusesAllAccounts` (R-c) and `.findBillingStatusForAccount` (R-c′) are marked "NOT WIRED since Finance R4" | `lib/repositories/BusinessOsFinanceReadRepository.ts:484-578` |
| **No production caller.** `git grep` over `lib app scripts tests` finds the method names only as (a) **deps keys** in `financeHealthDeps.ts:144-145`, wired to `listCurrentModeBillingStatusesAllAccounts` / `findCurrentModeBillingStatusForAccount`; (b) the `Pick` in `financeHealth.ts:279-280`; (c) tests. There is no `businessOsFinanceReadRepository.listBillingStatuses…(` call anywhere, and `lib/admin/billing/__tests__/currentModeBillingStatus.test.ts:250` already pins that | — |
| **So the deps keys still run on every load, and the repository methods never run.** Removing the methods removes **no runtime read** | — |
| Helpers that only R-c / R-c′ use: `FINANCE_BILLING_STATUS_COLUMNS` (re-exported by `lib/repositories/index.ts:100`), `FINANCE_READ_LIMITS.BILLING_PAGE_SIZE` / `.BILLING_CEILING`, `FinanceReadDuplicateError` | Repository lines 153-158, 436-440 |
| `FinanceBillingStatusRow` is still used, as the row shape of the current-mode reads, by `financeHealth.ts` (`payingSetOf`, line 605) and by tests | — |
| After removal the repository no longer opens `business_os_billing_accounts`. This moves the finance table pin and the billing-table reader list | `finance.source.guard.test.ts:337-357`; `BusinessOsBillingAccountRepository.test.ts:1344-1371` |

### Step 0 facts, part B: a read that runs and is not shown (R-d)

| Fact | Where |
|---|---|
| R-d `countRevenueRows` (two platform-wide head counts) runs on every all-businesses load | `financeHealth.ts:731` |
| Its only use is `revenue.state` (`'recorded' \| 'none_yet' \| 'unknown'`) and one log count (`revenueExistence`) | `financeHealth.ts:1127-1145`, `:1677` |
| `revenue.state` is read in exactly one place, and only as an attribute: `data-state={revenue.state}` on `revenue-body`. No text, colour, tile or notice reads it. The K-5 "No data yet" comes from `k5Money.kind`, not from `state` | `app/admin/finance/components/RevenuePanel.tsx:137`; `git grep "revenue\.state\|none_yet"` over `app lib` without tests |
| Nothing else consumes it: not the snapshot (its deps `Pick` holds only the billing key), not the export, not the strip | `financeSnapshotDeps.ts:27` |
| Every other read in the Overview `Promise.all` was traced to a rendered field (quick pass: client plans, reminders, overdue tables, boosts and events, recorded, gifted and bought, top accounts, by trigger, by group, deleted) | `app/admin/finance/components/*` |

### Fix

**A (R4-FU-1 as written; always in):**
1. Delete `listBillingStatusesAllAccounts` and `findBillingStatusForAccount` from the repository, with `FINANCE_BILLING_STATUS_COLUMNS`, the two `BILLING_*` limits, `FinanceReadDuplicateError` and their barrel re-exports. Fix the header comments that name R-c and R-c′ (lines 74, 84, 100-109).
2. `FinanceHealthDeps['finance']` stops picking those two keys from the repository. They become explicit function types on the same keys:
   `listBillingStatusesAllAccounts: (opts?: { pageSize?: number; ceiling?: number }) => Promise<RepoResult<FinanceBillingStatusRow[]>>` and `findBillingStatusForAccount: (accountId: string) => Promise<RepoResult<FinanceBillingStatusRow | null>>`.
   The **key names stay** (SA-Q-FU-4), so the wiring, the snapshot `Pick`, the `currentModeBillingStatus` source pins and the AC-145 named-reads map are unchanged. No mode word enters a finance file.
3. `FinanceBillingStatusRow` stays in the repository file as a type, with its doc comment re-pointed to the current-mode reader (SA-Q-FU-4).
4. Delete the R-c / R-c′ describes in `BusinessOsFinanceReadRepository.test.ts` (lines 144-290) and their imports.

**B (R-d; in only if SA-Q-FU-3 is approved):**
5. Delete R-d from the builder (`revenueResult`, `NOT_CALLED_REVENUE`, the `state` block), the deps key `countRevenueRows`, the wiring line, the repository method and its tests. Remove `state` from `FinanceRevenueSection` and the `FinanceRevenueState` type, and `revenueExistence` from the log counts. Remove `data-state` from `RevenuePanel.tsx:137`, and fix the route's doc comment (lines 45, 324).
6. The account-scoped `state` (computed from R-k′ / R-m′, no extra read) goes too. It is not shown either.

### Tests

- Repository: the R-c / R-c′ describes are removed. The remaining R-e … R-n describes are unchanged.
- `finance.source.guard.test.ts`: the table pin is ruled (see pins). A new assertion: the repository source has no `listBillingStatusesAllAccounts`, `findBillingStatusForAccount` or `countRevenueRows` (with B).
- `BusinessOsBillingAccountRepository.test.ts`: the reader list is ruled.
- `financeHealth.test.ts`: the mocks keep the two billing keys. With B, the `countRevenueRows` mocks and the `state` assertions are removed (ruled test edits), and one new case asserts the payload's `revenue` has no `state` key.
- `route.test.ts`: AC-145 with B (see pins). Without B, AC-145 is unchanged.
- **Removal proof (no consumer):** the `git grep` commands above are re-run after the change and pasted into the workplan: 0 production hits for the removed names.

---

## Item 10: FF-3, range-cap allow-list burn-down

### Source

[BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) line 5074:

> "FF-1d: `rangeCap.source.guard.test.ts` against one-shot reads above PostgREST's 1,000-row cap, allow-list pinned at 14 files / 20 entries (FF-3 burn-down, can only shrink)."

[BUSINESS_OS_FINANCE_HEALTH_FOLLOWUPS_FF1_RETROSPECTIVE.md](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_FOLLOWUPS_FF1_RETROSPECTIVE.md) line 42:

> "**A guard beats a skill note for silent caps.** New one-shot wide reads now fail CI. The 20 existing entries are burn-down debt (FF-3)."

Same retrospective, lines 25-26, 44:

> "**B-1:** BizQL's truncation never fires above 1,000 rows." · "**B-2:** the purge preview and snapshot under-read. Purge itself is not live." · "B-1 and B-2 (separate tasks)"

### Step 0 facts

- The guard is `lib/repositories/__tests__/rangeCap.source.guard.test.ts`. `BASELINE_ENTRIES = 14`, `BASELINE_CALL_SITES = 20`. Each entry must be found exactly as often as listed, so a fixed site forces its entry out.
- The requirement's "14 files / 20 entries" is really **14 entries / 20 call sites in 11 files**. The pins in code are the source of truth.
- **None of the 14 is in Finance.** Breakdown:

| # | Entry | Sites | Kind | Owner / note | Plan |
|---|---|---|---|---|---|
| 1 | `AuditTrailRepository.ts` `.limit(OWNER_ACTIVITY_SCAN_CAP)` = 5,000 | 1 | repository, in-memory group-by | audit / insights | **Tranche A** |
| 2 | `SmartLinkRepository.ts` `.limit(CAP)` = 20,000 | 1 | repository, distinct visitors | smart links | **Tranche A** |
| 3 | `InsightRepository.ts` `.limit(VISITOR_SCAN_LIMIT)` = 5,000 | 1 | repository, distinct visitors | insights | **Tranche A** |
| 4 | `BaseDetector.ts` `.limit(2000)` (payers) | 1 | detector, direct `this.supabase` | insights | FF-3b |
| 5 | `BaseDetector.ts` `.limit(5000)` (page views) | 1 | detector | insights | FF-3b |
| 6 | `AcqLowConversionDetector.ts` `.limit(5000)` | 1 | detector | insights | FF-3b |
| 7 | `ConvServiceRateDropDetector.ts` `.limit(2000)` | 2 | detector | insights | FF-3b |
| 8 | `ConvStageDropoffDetector.ts` `.limit(2000)` | 1 | detector | insights | FF-3b |
| 9 | `app/api/business-os/stats/route.ts` `.limit(2000)` | 1 | **route with a direct `supabaseServer` call** (rule 1) | BOS dashboard | FF-3b (needs a repository first) |
| 10 | `app/api/payments/money/route.ts` `.limit(GROUPING_CAP)` = 2,000 | 3 | **route with direct calls**; `GROUPING_CAP` is also the Zod `max` of `limit` | payments | FF-3b (needs a repository first) |
| 11 | `ChatBudget.ts` `.limit(20000)` | 1 | BizQL telemetry, direct `supabaseServer` | chat | FF-3b |
| 12 | `compiler.ts` `.limit(AGGREGATE_SCAN_CAP+1)` | 3 | BizQL compiler, cap-plus-one probe | chat (**B-1**) | Stays with B-1 |
| 13 | `compiler.ts` `.limit(ANTI_JOIN_CAP+1)` | 1 | BizQL compiler | chat (**B-1**) | Stays with B-1 |
| 14 | `BusinessPurgeRepository.ts` `.limit(VIA_PARENT_CAP)` | 2 | purge, destructive path | purge (**B-2**) | Stays with B-2 |

- **Today these "floor" checks never fire.** Each tranche A site has a "the read hit its cap, the figure is a floor" warning (`AuditTrailRepository.ts:484`, `SmartLinkRepository.ts:612`, `InsightRepository.ts:3878`). PostgREST returns at most 1,000 rows, so `length >= 5000` (or `20000`) can never be true. A large account today gets a silently cut figure that is not flagged.
- Tranche A sites have no unit test today (`git grep` for the method names in `*.test.ts`: none).

### Fix (tranche A, the SA-Q-FU-6 default)

At each of the three sites, inside the existing repository method (no new method, no new shared module):

- Read in pages of **1,000** rows with `.range(offset, offset + PAGE - 1)` and a **total order**: the existing order plus `id` as a tie-break. Stop on a short page or at the site's existing ceiling (5,000 / 20,000 / 5,000), so the ceilings are unchanged.
- The existing "floor" warning now fires correctly at the ceiling.
- The query filters are unchanged: `.eq('user_id', userId)`, or the existing `in('smart_link_id', linkIds)` that the caller scopes.
- Column names (`id` on `audit_trail`, `smart_link_clicks`, `website_page_views`) are checked against the live schema with the `business-os-schema-check` skill before coding.
- The guard: delete entries 1-3 and lower `BASELINE_ENTRIES` 14 → **11** and `BASELINE_CALL_SITES` 20 → **17**, in the same change, as its header requires.

**Behaviour:** for an account under 1,000 rows, nothing changes. For a larger account, the figure becomes correct (larger) or is correctly flagged as a floor, at the cost of one request per 1,000 rows. The UI is unchanged.

### Deferred, with a proposal

- **FF-3b** (entries 4-11, 11 sites, about 3 days). The detectors and routes call Supabase directly. Paging them in place would widen a rule 1 deviation. Done properly, each moves its read into a repository first, which is a scaffold per site under the `new-repository` skill. The insight owner should take part.
- **Entries 12-14** stay with B-1 and B-2, which already exist as separate tasks. Fixing them here would duplicate those tasks and touch the chat planner (needs `npm run eval:chat --no-cache`) and the purge path.

### Tests

- One new test per tranche A method, with a fake client that serves 1,000-row pages:
  - 2,500 rows: all read in 3 requests, each `.range` span ≤ 1,000;
  - exactly 1,000: a second request returns 0 rows and stops;
  - at the ceiling: it stops, and the floor warning is logged;
  - an error on page 2: the error result (no partial figure presented as exact);
  - `user_id` (or `smart_link_id`) present on every page.
- `rangeCap.source.guard.test.ts`: the pins are lowered, and "finds no offence outside the baseline" stays green.

---

## Item 11: CPU1A-FU-1, the leak guard's function-parameter form

### Source

[CLIENT_PAYMENTS_USD_1A_RETROSPECTIVE.md](/docs/retrospectives/CLIENT_PAYMENTS_USD_1A_RETROSPECTIVE.md) line 30:

> "**Follow-up CPU1A-FU-1 (Low):** a typed destructure in a `function` declaration's parameters still slips past the guard. Add one pattern and a control in 1b."

The TL brief moves it from 1b into this bundle.

### Step 0 facts

- Guard: `lib/admin/exchangeRates/__tests__/clientPaymentsUsd.source.guard.test.ts`. A file is a holder if `TOKENS` match, or `TYPED_USD`, which is `REACHES_TAKINGS && READS_USD` (lines 242-245).
- `READS_USD`'s destructure branch is `\{[^{}]*\busd\b[^{}]*\}(?:\s*\})*\s*(?::[^=;]*)?=`, which needs a following `=`.
  - An **arrow** function's typed parameter is caught, through the `=` of `=>`.
  - `function f({ usd }: FinancePayload["takings"]) { … }` is **not** caught: `)` then `{`, no `=`. The same goes for a class method `f({ usd }: T) {`.
- `ALLOWED` (lines 246-254) has 6 files. The brief says it stays unchanged.

### Fix

Add one alternative to `READS_USD`: a typed destructure followed by the end of a parameter, `\{[^{}]*\busd\b[^{}]*\}\s*:[^=;{)]*[,)]`. It stays ANDed with `REACHES_TAKINGS`, so it is scoped to files that reach takings. It covers the function declaration, the method, and a destructure that is not the last parameter.

### Tests

- **Must catch** (added to `MISSED_FORMS`, so it runs in every one of the 17 zones, plus the regex-only check):
  - `function f({ usd }: FinancePayload["takings"]) { return usd; }`
  - `function g({ usd: approx }: FinancePayload["takings"], n: number) { return approx; }`
  - `class K { m({ usd }: FinanceTakingsSection) { return usd; } }`
- **Must not catch** (added to the B-1 precision test):
  - `function f({ usd }: Other) {}` in a file that does not reach takings;
  - `function f({ amount }: FinancePayload["takings"]) {}`, in a takings file, no `usd`;
  - `const x: Array<{ usd: number }> = [];` in a takings file: a type literal, not a parameter;
  - `function f(usd: number) {}` in a takings file: no destructure.
- The real-files assertion still passes with `ALLOWED` unchanged. This is checked at implementation by running the guard. If any non-allowed file trips the new form, it is reported to SA, not allow-listed.

---

## Files to Create / Modify

| File | Action | Item | Reason |
|---|---|---|---|
| `lib/business-os/finance/financeWindow.ts` | modify | 2 | `k1Spans.current.to` = next UTC midnight |
| `lib/business-os/finance/financeHealth.ts` | modify | 2, 9 | K-1 reuses the window read when spans match; deps type no longer picks R-c / R-c′; R-d removed (B) |
| `lib/business-os/finance/__tests__/financeWindow.test.ts` | modify | 2 | New span end |
| `lib/business-os/finance/__tests__/financeHealth.test.ts` | modify | 2, 9 | Window-filtering equality cases; R-d mocks and `state` asserts removed (B) |
| `app/api/admin/business-os/finance/__tests__/route.test.ts` | modify | 2, 9 | AC-145 ruled moves |
| `app/admin/finance/components/PayingBreakdownSection.tsx` | modify | 3 | One Unknown; rate line hidden when Paid is unknown |
| `app/admin/finance/financeCopy.ts` | modify | 3 | `PAYING_BREAKDOWN.paidUnknown` value only (**1b overlap**) |
| MK-9 paying-breakdown render test (`app/admin/finance/__tests__/`) | modify | 3 | Single-Unknown assertions |
| `lib/business-os/finance/payingBreakdown.ts` | modify | 5 | Comment only |
| `lib/business-os/finance/__tests__/recordedInWindow.wireTypes.test.ts` | modify | 6 | Exact `Equals` + controls |
| `lib/business-os/credits/__tests__/creditReport.wireTypes.test.ts` | modify | 6 | Exact `Equals` + controls |
| `lib/repositories/BusinessOsFinanceReadRepository.ts` | modify | 9 | R-c, R-c′ (and R-d with B) and their helpers removed |
| `lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts` | modify | 9 | Their tests removed |
| `lib/repositories/index.ts` | modify | 9 | Barrel re-exports removed |
| `lib/business-os/finance/financeHealthDeps.ts` | modify | 9 | Doc comment; `countRevenueRows` line (B) |
| `lib/business-os/finance/financeTypes.ts` | modify | 9 (B) | `FinanceRevenueSection.state`, `FinanceRevenueState` removed |
| `app/admin/finance/components/RevenuePanel.tsx` | modify | 9 (B) | `data-state` removed |
| `app/api/admin/business-os/finance/route.ts` | modify | 9 (B) | Doc comment only (lines 45, 324); handler untouched |
| `lib/business-os/finance/__tests__/finance.source.guard.test.ts` | modify | 9 | Table pin ruled; removed-method absence check |
| `lib/repositories/__tests__/BusinessOsBillingAccountRepository.test.ts` | modify | 9 | Billing-table reader list ruled |
| `lib/business-os/finance/__tests__/financeSnapshot.test.ts` | modify | 9 (B) | `countRevenueRows` stub removed |
| Render tests whose fixtures carry `revenue.state` (finance and `app/admin/users/__tests__/*`) | modify | 9 (B) | Fixture key removed (test data only) |
| `lib/repositories/AuditTrailRepository.ts` | modify | 10 | Paged read |
| `lib/repositories/SmartLinkRepository.ts` | modify | 10 | Paged read |
| `lib/business-os/insight/repository/InsightRepository.ts` | modify | 10 | Paged read |
| `lib/repositories/__tests__/rangeCapTrancheA.paging.test.ts` | create | 10 | Paging tests for the three methods |
| `lib/repositories/__tests__/rangeCap.source.guard.test.ts` | modify | 10 | 3 entries out; pins 14 → 11, 20 → 17 |
| `lib/admin/exchangeRates/__tests__/clientPaymentsUsd.source.guard.test.ts` | modify | 11 | One pattern + controls (**possible 1b overlap**) |
| This workplan | create | — | — |

Docs owned by BA (not edited by Dev): FIN requirement §0.4 rows R4-FU-1 / FF-3 and a Change History line; the review doc's log. Dev will hand BA the exact rows after SA review.

---

## Overlap with slice 1b

Slice 1b (`neuronforge-cpu1b`) touches `TakingsSection.tsx`, `financeCopy.ts`, `financeFormat.ts`, `BlockKpi.tsx`, `ExchangeRatesView.tsx`, and possibly the CPU leak guard.

| File | This bundle | 1b | Conflict risk |
|---|---|---|---|
| `app/admin/finance/financeCopy.ts` | **Yes**: one value in `PAYING_BREAKDOWN` (line ~873) | Yes: takings copy (a different block) | Low: different hunks. Whichever lands second rebases |
| `lib/admin/exchangeRates/__tests__/clientPaymentsUsd.source.guard.test.ts` | **Yes**: `READS_USD`, `MISSED_FORMS`, the precision test | Possibly | Medium if 1b also edits `MISSED_FORMS` or `ALLOWED`. 1b should leave the function-parameter pattern to this bundle |
| `TakingsSection.tsx`, `financeFormat.ts`, `BlockKpi.tsx`, `ExchangeRatesView.tsx` | No | Yes | None |
| `route.test.ts` (AC-145) | Yes | Only if 1b changes the payload, which a UI slice should not | Low. If both re-freeze, the second rebases its hash |

---

## Pin and baseline moves

Each move is one ruled re-freeze, with a removal proof. Old values are kept in the test as named constants, following the file's existing chain.

| Pin / baseline | Moves? | Item | Detail and removal proof |
|---|---|---|---|
| **AC-145 `EXPECTED_CALLS`** | **Yes** | 2 | `ledger.listRowsOfAllAccountsCreatedInRange` loses its second row (`{2026-10-01 → 2026-10-14T12:00}`), because K-1 reuses the window read (frozen now Oct 14, This month `[Oct 1, Oct 15)`). If SA chooses span-only (SA-Q-FU-1 option A), the row stays and its `to` becomes `2026-10-15T00:00:00.000Z`. Proof: the reuse test in `financeHealth.test.ts` |
| **AC-145 `EXPECTED_CALLS`** | **Yes (B only)** | 9 | `finance.countRevenueRows: [[]]` is removed (the key leaves `mockDeps.finance`). R-c / R-c′ keys **unchanged** (they are deps keys, still wired) |
| **AC-145 `EXPECTED_SHA256`** (`aebc22cbbb234106b92ff83c99cee138b4b8701d46f700254d1bc048e92597ca`) | **Yes (B only)** | 9 | Re-freeze to the new hash. **Removal proof:** put `revenue.state` back at its key position (after `revenue.status`) and the hash is `aebc22cb…97ca` again. The existing chain (AFTER_MK9 … SLICE_6A) then runs unchanged **from that restored object**, so no older hash moves. Item 2 does not move the hash: the route test's ledger mock returns the same rows for every range, so F-K3's value is unchanged (checked at implementation, and raised to SA if not) |
| **AC-173** (one request on load) | No | — | No client fetch changes |
| **Pin A** (KpiStrip callers) | No | — | No shared layout component touched |
| **Pin B** (`financeTiles.pin.render.test.tsx`) | **Yes (FU-C1, corrected)** | 9B | The fixture `revenueSection()` is a typed `FinanceRevenueSection` with `state: 'none_yet'`; once `state` leaves the type that line is an excess-property error, so it goes. **One ruled re-freeze of the file hash:** `a1b3db0ccb6cb76cec8181e62225829872cc9845208151484c2657be530f11e4` → `eac3590add2dbb71dcbd292e11ead5e220ee55164d46314b56155c700162877b` (SHA-256, LF-normalised). The diff is that one deleted line (`git diff --numstat`: 0 added, 1 deleted). Every tile value, status and order assertion is unchanged and passes |
| **Pin C** (AI cost / Charge checks requests) | No | — | A-K1 side unchanged (item 2 rationale) |
| **Pin D** (Health wording) | No | — | — |
| **T-12** (AI cost page requests) | No | — | A-K1 side unchanged |
| **Finance table pin** `REPOSITORY_TABLES` (9 tables) | **Yes** | 9 | `business_os_billing_accounts` leaves; 9 → **8**, and `tables.length >= 9` → `>= 8`. Proof: `git grep "business_os_billing_accounts" lib/repositories/BusinessOsFinanceReadRepository.ts` → 0. R-d removal does not move it (its two tables are still read by R-k / R-m) |
| **4B2-R1** "exactly the pager's `.limit(size)`" | Check | 9 | R-c used `.limit(size)` too. The layer-B pager also does, so `toContain('.limit(size)')` should hold. Verified at implementation |
| **Billing-table reader list** (`BusinessOsBillingAccountRepository.test.ts`) | **Yes** | 9 | 3 → **2** readers (the account repository and the admin read repository). The "finance read repository only reads it" assertion becomes "the finance read repository does not open the billing table" |
| **Range-cap allow-list** | **Yes** | 10 | `BASELINE_ENTRIES` 14 → **11**, `BASELINE_CALL_SITES` 20 → **17** (tranche A). Proof: each removed entry's "still present exactly as listed" case would fail on 0 hits |
| **CPU leak guard `ALLOWED`** | No | 11 | Unchanged by rule |
| **`typecheck:bos-llm` baseline** | No | 6 | No new error. The new aliases compile clean |

---

## Acceptance criteria

| Id | Criterion | Item |
|---|---|---|
| FU-AC-1 | With This month picked (all businesses, or one business), F-K3's value equals Section 3's charged total and the AI cost page's A-K1 for the same data. A test with a window-filtering fake ledger proves it, including a charge dated later today | 2 |
| FU-AC-2 | With This month picked, Finance makes **one** ledger read for Section 3 and F-K3 together. On any other window, K-1's own read ends at the next UTC midnight | 2 |
| FU-AC-3 | K-1's previous span ("same elapsed time last month") is unchanged in every existing `k1Spans` case | 2 |
| FU-AC-4 | Q-R1 holds: on an unreadable amount F-K3 is Unknown, while A-K1 and Section 3 say "at least" | 2 |
| FU-AC-5 | With the first payments missing, the trial-to-paid block shows "Paid: Unknown" **once**, with the reason "(first payments could not be read)", and no rate line | 3 |
| FU-AC-6 | With Paid known, the rate, too-few and cut-off lines render exactly as before | 3 |
| FU-AC-7 | The `payingBreakdown.ts` comment says the case is unreachable and why. No logic change (diff is comment-only) | 5 |
| FU-AC-8 | Both wire-type files carry an exact `Equals<Norm<A>, Norm<B>>` check and two `@ts-expect-error` controls. `npm run typecheck:bos-llm` is clean. A planted one-sided optional field fails it (recorded in QA) | 6 |
| FU-AC-9 | `BusinessOsFinanceReadRepository` has no `listBillingStatusesAllAccounts` / `findBillingStatusForAccount` and no longer opens `business_os_billing_accounts`. The deps keys of the same name still reach the current-mode reader (the existing `currentModeBillingStatus` pins pass unedited) | 9 |
| FU-AC-10 | (B) R-d is gone: no `countRevenueRows` anywhere in production code, no `revenue.state` in the payload, and the Overview makes two fewer head counts | 9 |
| FU-AC-11 | Finance page visuals unchanged: Pin A, Pin B, Pin C, Pin D, T-12 and AC-173 pass unedited | 2, 3, 9 |
| FU-AC-12 | AC-145 moves exactly as in the pin table, with the removal proof in the test | 2, 9 |
| FU-AC-13 | The three tranche A methods read in pages of ≤1,000 rows with a total order, stop at their existing ceilings, keep their `user_id` / link scoping on every page, and log the floor warning at the ceiling | 10 |
| FU-AC-14 | The range-cap guard is green with `BASELINE_ENTRIES = 11`, `BASELINE_CALL_SITES = 17` | 10 |
| FU-AC-15 | The leak guard catches the three function-parameter forms in every zone, does not catch the four precision controls, and passes on the real tree with `ALLOWED` unchanged | 11 |
| FU-AC-16 | Every route still calls `requireAdmin` first (`npm run test:authz-guard` green). The finance livemode guard and CUR-3 pass unedited | all |
| FU-AC-17 | `npm run build` succeeds, and the typecheck is clean for touched files (filtered, OOM checked). Jest: finance, repositories, admin finance, AI cost, exchange rates, insight and smart link suites green. `npm run test:bos-entitlements` green | all |

---

## Estimate

| Item | Estimate |
|---|---|
| 2 MK2-FU-1 | 0.75 d |
| 3 MK9-FU-1 | 0.25 d |
| 5 MK9-FU-3 | 0.1 d |
| 6 MK3A-FU-1 | 0.4 d |
| 9 R4-FU-1 (A) | 0.4 d |
| 9 R-d removal (B) | 0.6 d |
| 10 FF-3 tranche A (3 entries) | 1.25 d |
| 11 CPU1A-FU-1 | 0.3 d |
| Review and QA fix buffer | 0.5 d |
| **Bundle as proposed** | **about 4.5 days** |
| FF-3b (entries 4-11, with repositories) | +3 d, its own slice |
| B-1 / B-2 entries | already separate tasks |

**The full brief, with all of FF-3, is about 7.5 days. That is clearly more than 3.** Proposal: ship this bundle with FF-3 tranche A (about 4.5 days). For about 3 days, also defer tranche A, giving about 3.25 days and an allow-list unchanged at 14 / 20. Default: tranche A in.

**User decision 2026-10-27 (BQ-FU-3): tranche A only, R-d removal included (BQ-FU-2). Estimate set at about 4.5 days.** FF-3b and B-1 / B-2 are scheduled later.

---

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | Item 2's reuse makes K-1 depend on Section 3's read. A failed window read now also makes F-K3 Unknown on This month, where before one read could fail alone | Same outcome the user wants: one figure. A test pins that both say Unknown together. Other windows are unaffected |
| R-2 | Item 2 changes when K-1 reads at a month boundary (`current` no longer empty at 00:00:00 on the 1st) | Zero rows, exact 0. Test updated |
| R-3 | Removing `revenue.state` (B) breaks a consumer missed in Step 0 | Payload key removal is caught by TypeScript on every typed consumer. `git grep` proof re-run after the change. The export and snapshot were checked |
| R-4 | The `Equals` helper is stricter than `Satisfies` (readonly, `any`) and could fail on a future honest change | It is what SA proposed. The message is TS2344 on `Exact`, and the `Satisfies` pair stays for the clearer diagnosis |
| R-5 | Tranche A paging: offset paging over a changing table can skip or repeat a row between pages | All three are approximate distinct counts or counts already labelled floors. The `id` tie-break gives a stable order. Keyset by `(order col, id)` was considered and is heavier. SA-Q-FU-7 |
| R-6 | Tranche A sends more requests for large accounts (up to 5 or 20 per call) | Only above 1,000 rows. Ceilings unchanged. Today those accounts get a wrong number |
| R-7 | The leak guard's new form flags a real file outside `ALLOWED` | Checked by running the guard. If it happens, it goes to SA and is never allow-listed quietly |
| R-8 | Merge order with 1b (`financeCopy.ts`, the leak guard) | Different hunks; see the overlap table |
| R-9 | The shared `node_modules` junction: a package change in another worktree affects this one | No package change in this bundle |

---

## SA questions

| Id | Question | Dev default |
|---|---|---|
| SA-Q-FU-1 | Item 2 mechanism: (A) only move `k1Spans.current.to` to the next UTC midnight; or (A+B) also reuse the window read when the spans match, for one read and the same rows by construction? | **A+B.** It makes "identical" hold by construction within a load and removes a read. AC-145 loses one call |
| SA-Q-FU-2 | Item 2: keep the Q-R1 split (F-K3 Unknown on an unreadable amount, A-K1 "at least"), even though it is the one case where the two This-month figures are not identical? | **Keep.** It was ruled as a trend-tile rule |
| SA-Q-FU-3 | Item 9 scope: R4-FU-1 as written removes no runtime read. Also remove R-d and `revenue.state`, which run on every load and are shown nowhere? It re-freezes AC-145's hash once | **Yes, include R-d.** It is the read that matches the brief ("still run, no longer shown"), and it is a payload change with a clean removal proof |
| SA-Q-FU-4 | Item 9: keep the deps key names `listBillingStatusesAllAccounts` / `findBillingStatusForAccount` (explicit function types, AC-145 untouched), and keep `FinanceBillingStatusRow` in the repository file? Or rename the keys and move the type to `financeTypes.ts`? | **Keep both.** Renaming moves AC-145's named reads, the snapshot `Pick` and the `currentModeBillingStatus` source pins for no user gain |
| SA-Q-FU-5 | Item 6 scope: the two files SA named (`recordedInWindow`, `creditReport`), or all 9 `*.wireTypes.test.ts`? | **The two.** The other 7 can be a later follow-up (MK3A-FU-1b), each probed first, because some of them may not be exactly equal today |
| SA-Q-FU-6 | Item 10: tranche A (3 repository sites) in this bundle, FF-3b (8 entries, 11 sites, repository moves first) as its own slice, entries 12-14 left to B-1 / B-2? Inline paging loops per method, or a new shared paging helper? | **Tranche A here, inline loops.** A shared helper is a new pattern and can come with FF-3b if SA wants it |
| SA-Q-FU-7 | Item 10: offset paging (`.range`) with an `id` tie-break, or keyset paging on `(order column, id)`? | **Offset.** The figures are already approximate distinct counts or labelled floors |
| SA-Q-FU-8 | Item 11: also catch the untyped `function f({ usd }) {}` in a takings file? | **No.** The item names the typed form, and an untyped destructure in a takings file is rare. It can be added if SA wants the conservative form |
| SA-Q-FU-9 | Item 3: hide the rate line when Paid is unknown, rather than show "No rate: paid is unknown"? | **Hide.** One Unknown, one reason, as the brief asks |
| SA-Q-FU-10 | Requirement updates: BA updates FIN §0.4 (R4-FU-1 closed; FF-3 partly burned down, FF-3b added; R-d removal recorded) and the review doc's log, in the same PR? | **Yes, BA, same PR.** Dev supplies the rows |

---

## Business questions (separate)

**Answered by the user on 2026-10-27 (relayed by TL). These are user decisions:**

| Id | User decision |
|---|---|
| BQ-FU-1 (item 2) | **Yes.** "Identical" means the same result for data read at the same moment. A charge made between two separate page loads may differ until the older page is reloaded |
| BQ-FU-2 (item 9) | **Yes. Remove R-d and `revenue.state` as well.** The gain is milliseconds, and nothing on screen changes. This settles the business side of SA-Q-FU-3. SA still rules on the technical side (AC-145 re-freeze and removal proof) |
| BQ-FU-3 (item 10) | **FF-3 tranche A only** (entries 1-3; allow-list 14/20 → 11/17). The rest becomes **FF-3b**, scheduled later. The BizQL compiler and purge sites stay with **B-1 / B-2**, also scheduled later |

**Bundle estimate, confirmed: about 4.5 days.**

The original questions, kept for the record:

| Id | Question | Default |
|---|---|---|
| BQ-FU-1 | You asked that F-K3 and A-K1 "always show the identical figure" with This month picked. After this change they are one computation over the same rows. Two pages loaded at **different moments** can still differ by a charge made between the two loads, and reloading the older page makes them equal again. Holding them equal across separate loads would need a shared stored snapshot, a different and larger feature. Is "identical for the same moment" what you meant? | Yes |
| BQ-FU-2 | Item 9: you expected "fewer reads, a slightly faster page". R4-FU-1 as written removes dead code only: those reads were already not running. The reads that do go are R-d (two small counts, if SA approves) and one AI cost ledger read on This month (item 2). The page gets a little faster, by milliseconds rather than seconds. Is that acceptable? | Yes |
| BQ-FU-3 | Item 10: you approved FF-3 in full. Doing all of it is about 4.5 extra days and touches the chat engine and purge, which already have their own tasks (B-1, B-2). Can this bundle do the first 3 of 14 entries, with the rest as FF-3b and the B-1 / B-2 tasks? | Yes |

---

## Task List

- [x] Step 0a: BQ-FU-1 to BQ-FU-3 answered by the user (2026-10-27): yes, yes, tranche A only
- ✅ Step 0b: SA review of this workplan (SA-Q-FU-1 to SA-Q-FU-10); no code until SA approves
- ✅ Step 1: Item 5, the comment (smallest, no test move)
- ✅ Step 2: Item 6, the `Equals` checks in both wire files; `npm run typecheck:bos-llm`; planted proof for QA
- ✅ Step 3: Item 11, the leak-guard pattern and controls; run the guard on the real tree
- ✅ Step 4: Item 3, `PayingBreakdownSection` and the `paidUnknown` value; render tests
- ✅ Step 5: Item 2, `k1Spans`, the reuse wiring, the window-filtering tests, AC-145 calls
- ✅ Step 6: Item 9A, remove R-c / R-c′ and helpers; deps type; table pin and reader list
- ✅ Step 7: Item 9B (if approved), remove R-d and `revenue.state`; AC-145 hash re-freeze with removal proof
- ✅ Step 8: Item 10 tranche A, schema check, three paged reads, paging tests, guard pins 11 / 17
- ✅ Step 9 (local part; CI's required Build is the build proof, FU-C6): Ship drill step 1: `npm run build`, typecheck filtered to touched files, the Jest suites in FU-AC-17, `test:authz-guard`, `test:bos-entitlements`, `typecheck:bos-llm`
- ✅ Step 10: Paste the removal-proof `git grep` output and the test counts into this workplan; hand BA the requirement rows

---

## SA Review Notes

### SA Workplan Review (SA-WP-FU)

**Reviewed by SA — 2026-10-27** (code read in this worktree at `b7f02cd6`)
**Status:** ✅ Approved with conditions (FU-C1 to FU-C7). One pin-table error needs correcting first (FU-C1).

**Fit.** Each item is placed in the right layer and is proportionate. Specifically:
- Item 2 fixes the trend tile, not the window figure, so Section 3 = A-K1, T-12 and Pin C hold for every window.
- Item 9 states honestly that R4-FU-1 by itself removes no runtime read.
- Item 10 keeps the rule-1 detector and route sites out of an inline fix.
- No route handler, Zod schema or migration changes. CUR-3, the livemode guard and `requireAdmin` are untouched.

**Rulings on the SA questions**

| # | Ruling |
|---|---|
| SA-Q-FU-1 | **A+B, approved.** The reuse condition must compare the clamped read's instants exactly (`readFrom` and `end` against `spans.current`), never a window label. Test R-1 (a failed window read makes Section 3 and F-K3 both Unknown on This month) is required. |
| SA-Q-FU-2 | **Keep Q-R1.** It is a ruled trend-tile rule; FU-AC-4 pins it. |
| SA-Q-FU-3 | **Include R-d, approved.** The user agreed too (BQ-FU-2). Two head counts run on every load and are shown nowhere. Removing them is a clean payload change. Condition: **FU-C1** (Pin B moves). |
| SA-Q-FU-4 | **Keep both.** The key names stay, as explicit function types, and `FinanceBillingStatusRow` stays in the repository file with its doc comment re-pointed. Renaming would move AC-145's named reads, the snapshot `Pick` and the current-mode pins for no gain. |
| SA-Q-FU-5 | **The two files only.** Probe the other seven later (MK3A-FU-1b). The `Norm` + `Equals` helper stays **local to each file**, as the existing `Satisfies` does; no shared type module. |
| SA-Q-FU-6 | **Tranche A here, inline loops,** as the user decided (BQ-FU-3). I found no shared paging helper in `lib/repositories/`, so a helper would be a new pattern. Decide it with FF-3b, where 11 sites would share it. |
| SA-Q-FU-7 | **Offset paging with an `id` tie-break, approved.** All three are distinct-visitor or activity counts already labelled as floors at the ceiling. A row moving between pages can shift them by one, which the floor wording covers. Keyset paging is not needed. |
| SA-Q-FU-8 | **No** untyped form for now. That matches the brief. Add it with a precision control only if a real file ever needs it. |
| SA-Q-FU-9 | **Hide the rate line when Paid is unknown, approved.** Leave the cut-off and too-few branches byte-identical. |
| SA-Q-FU-10 | **Yes, the requirement rows go in the same PR.** BA and TL have no Edit tool, so route the FIN §0.4 and review-log edits to an agent that does, and check them with `git diff --numstat` (deletion without insertion means stop). |

**Pin moves, ruled**

| Pin | Ruling |
|---|---|
| AC-145 `EXPECTED_CALLS` | **Approved.** The second all-accounts ledger row goes (item 2, reuse), and `finance.countRevenueRows` goes (item 9B). The R-c / R-c′ keys are unchanged. |
| AC-145 `EXPECTED_SHA256` | **Approved, one re-freeze (B), with the restore proof.** Putting `revenue.state` back at its position gives `aebc22cb…97ca`, and the existing chain then runs unchanged. **If item 2 also changes the hash, stop and ask SA.** It should not, because the mock ledger ignores the range. |
| **Pin B (`financeTiles.pin.render.test.tsx`)** | **Moves. The workplan's "No" is wrong.** The file's `revenueSection()` returns a typed `FinanceRevenueSection` with `state: 'none_yet'` (line 249). Once `state` leaves the type, that line is an excess-property error, so the fixture line has to go. That changes the file's hash. **One ruled re-freeze:** record the before and after file hashes; the diff is that one line; every rendered tile value, status and order assertion is unchanged. |
| Finance table pin 9 → 8, billing-table readers 3 → 2 | **Approved,** with the `git grep` proof of no table. |
| Range-cap 14/20 → 11/17 | **Approved,** in the same change as the three fixes (the guard's own rule). |
| AC-173, Pins A, C and D, T-12, the CPU `ALLOWED` list, the `typecheck:bos-llm` baseline | **Do not move.** If any does, stop. |

**Overlap with 1b**
- **`financeCopy.ts`:** low risk, different hunks. Whichever lands second rebases.
- **The CPU leak guard:** this bundle owns CPU1A-FU-1. My SA-WP-CPU1B condition B-4 (FU-1 in 1b) is **superseded**: 1b leaves `clientPaymentsUsd.source.guard.test.ts` untouched. If 1b's UI genuinely needs a guard change, it comes back to SA before editing.
- **`route.test.ts`:** 1b changes no payload, so there is no conflict.

**Conditions**
1. **FU-C1:** correct the pin table so Pin B shows as moving under item 9B, as ruled above. Also re-check the other typed fixture builders that carry `state` (`financePage`, `financeAccount`, `route.test`, `financeHealth.test`). Those are test-data edits, not pins.
2. **FU-C2, item 11 regex:** the proposed alternative does not catch the **nested** parameter destructure `function f({ takings: { usd } }: FinancePayload) {}`, because the inner `}` is followed by ` }`, not `:`. Allow trailing braces (`\}(?:\s*\})*\s*:`), as the existing branch does, and add that form to the must-catch list. Every other must-catch and must-not-catch control stays as listed.
3. **FU-C3, item 10:**
   - Check `id` on each of the three tables with the `business-os-schema-check` skill before coding.
   - Each page repeats the same `user_id` / `smart_link_id` scope, and a test asserts it on every page.
   - A page error returns the error result, never a partial figure.
   - Each existing method keeps its signature, so callers do not change.
4. **FU-C4, item 6:** keep the two `@ts-expect-error` controls. Record the planted one-sided-optional proof for both files in the QA report, without committing it.
5. **FU-C5, item 9A:** the existing `currentModeBillingStatus` source pins pass **unedited**. Paste the removal-proof `git grep` output for the removed names (0 production hits) into the Implementation Notes.
6. **FU-C6, hygiene:** no `console.*` in touched files (confirmed 0). One commit, as the user approved. `npm run build` follows the 1a/1b precedent: local compile, plus CI's required Build as the proof.
7. **FU-C7, scope:** tranche A only, as the user decided (BQ-FU-3). FF-3b needs repository scaffolds and is a separate plan.

**Business questions:** all three are answered by the user (Change History, 2026-10-27). None remain open.

### Approval
[x] Workplan approved with conditions FU-C1 to FU-C7. Proceed.

---

## Implementation Notes (Dev, 2026-10-27)

Built on `chore/finance-followups-bundle` (from `origin/main` `b7f02cd6`), **uncommitted**, per SA-WP-FU. One commit is for RM (FU-C6).

### What was built, per item

| Item | Built |
|---|---|
| 2 MK2-FU-1 | `k1Spans.current.to` = next UTC midnight (`financeWindow.ts`). `buildFinanceHealth` shares Section 3's window read with K-1 when `clamp.readFrom` and `window.end` equal `spans.current` exactly (instants, never a label); a shared failure is logged once as `ledger_window`. New describe "MK2-FU-1" in `financeHealth.test.ts` with a **range-filtering** fake ledger (5 cases incl. SA R-1 and Q-R1); `financeWindow.test.ts` gains a "current span = This month window" case |
| 3 MK9-FU-1 | `PAYING_BREAKDOWN.paidUnknown` = "Paid: Unknown (first payments could not be read)"; the rate line is not rendered when Paid is unknown on an exact walk. Cut-off and too-few branches byte-identical. 2 new render cases |
| 5 MK9-FU-3 | Comment replaced in `payingBreakdown.ts` (comment-only diff) |
| 6 MK3A-FU-1 | Local `Equals` + `Norm` + `Expect` and two `@ts-expect-error` controls in both wire files (FU-C4) |
| 9A R4-FU-1 | R-c, R-c′, `FINANCE_BILLING_STATUS_COLUMNS`, the `BILLING_*` limits, `FinanceReadCeilingError`, `FinanceReadDuplicateError` removed (and their barrel re-exports and tests). `FinanceHealthDeps['finance']` = explicit types for the two billing keys `&` `Pick` of the rest. `FinanceBillingStatusRow` stays in the repository, doc re-pointed |
| 9B R-d | `countRevenueRows`, `FinanceRevenueCounts`, `revenue.state`, `FinanceRevenueState`, `counts.revenueExistence`, the wiring line and `data-state` removed |
| 10 FF-3 tranche A | `AuditTrailRepository.countOwnerActionsSince`, `SmartLinkRepository.uniqueVisitorsByLink`, `InsightRepository` visitor scan (new private `readVisitorIdentityRows`): `.range` pages of 1,000, `id` tie-break, ceilings 5,000 / 20,000 / 5,000 unchanged, scope on every page, signatures unchanged. Audit trail gains a counts-only floor warning at its ceiling. New `rangeCapTrancheA.paging.test.ts` (12 cases) |
| 11 CPU1A-FU-1 | One `READS_USD` branch: typed destructure ending a parameter, trailing braces allowed (FU-C2). 4 must-catch forms added to `MISSED_FORMS` (function, aliased not-last, method, **nested** `{ takings: { usd } }: FinancePayload`), a before/after proof case, and a precision case (4 must-not-catch). `ALLOWED` unchanged |
| Q-10 | FIN §0.4: R4-FU-1 marked closed, FF-3b row added, Change History row. Review doc: Change History row. `git diff --numstat`: FIN `3 1`, review `1 0` (no deletion without insertion) |

### FU-C3: live schema check (before item 10)

Zero-row, read-only selects against the live project (ref `jgccgkyhpwirgknnceoh`, run 2026-10-27 from the main checkout's `.env.local`, nothing written):

```text
audit_trail        | id, action, entity_type, entity_id, created_at, user_id | OK
smart_link_clicks  | id, smart_link_id, ip_hash, clicked_at                  | OK
website_page_views | id, session_id, ip_hash, is_owner_view, user_id         | OK
```

### FU-C5: removal proof (`git grep` over `lib app scripts`, tests excluded)

```text
repository calls of listBillingStatusesAllAccounts / findBillingStatusForAccount / countRevenueRows: 0
FINANCE_BILLING_STATUS_COLUMNS | FinanceReadCeilingError | FinanceReadDuplicateError | FinanceRevenueCounts
  | FinanceRevenueState | revenueExistence | BILLING_PAGE_SIZE | BILLING_CEILING: 0 (one doc-comment mention in the finance route saying it went)
business_os_billing_accounts in BusinessOsFinanceReadRepository.ts: 0
revenue.state readers: 0
```

The deps keys `listBillingStatusesAllAccounts` / `findBillingStatusForAccount` remain only as the explicit deps types, the current-mode wiring, and the snapshot `Pick`. `lib/admin/billing/__tests__/currentModeBillingStatus.test.ts` passes **unedited**.

### FU-C4: planted proof (not committed; types restored, `git status` clean on both type files)

| Plant | Result |
|---|---|
| none | both wire files compile clean |
| `extra?: number` on `CreditReportRecordedInWindow` | TS2344 on `ExactlyEqual` in **both** files; the two `Satisfies` pairs raise nothing (the old gap) |
| `extra?: number` on `CostReportPayload` | TS2344 on `ExactlyEqual` in `creditReport.wireTypes`, plus TS2578 on its top-level control (the control now compares the planted type with itself) |

### Pins, before → after

| Pin | Before | After |
|---|---|---|
| AC-145 `EXPECTED_CALLS` | `ledger.listRowsOfAllAccountsCreatedInRange`: 2 calls; `finance.countRevenueRows: [[]]` | 1 call (`[Oct 1, Oct 15)`); `countRevenueRows` key gone. R-c / R-c′ keys unchanged |
| AC-145 `EXPECTED_SHA256` | `aebc22cbbb234106b92ff83c99cee138b4b8701d46f700254d1bc048e92597ca` | `38897cd3295ae0c5e865503cf0394453c38f532b0ec87866610126281b1e4edf`. **Restore proof in the test:** `revenue.state: 'none_yet'` put back after `revenue.status` hashes to `aebc22cb…97ca` (`AFTER_CPU1A_SHA256`), and the older chain (AFTER_MK9 … SLICE_6A) runs unchanged from that object. Item 2 does not move the hash (the restored object equals the old bytes with item 2 applied) |
| Pin B file | `a1b3db0c…f11e4` | `eac3590a…2877b` (one line deleted) |
| Finance table pin | 9 tables | 8 (`business_os_billing_accounts` out) |
| Billing-table readers | 3 | 2 |
| Range-cap allow-list | 14 entries / 20 sites | 11 / 17 |
| AC-173, Pins A, C, D, T-12, CPU `ALLOWED`, `typecheck:bos-llm` baseline | — | unchanged (suites pass unedited; baseline file untouched) |

### Test edits outside new cases (ruled, test data or R-d / R-c removal)

- `financeHealth.test.ts`: two call counts move with MK2-FU-1 (This month 2 → 1 all-accounts reads; picked business 3 → 2); the R-d describe is replaced by an "R-d removed" describe; E-36 `state` cases removed; the wiring key list 21 → 20.
- `route.test.ts`: `countRevenueRows` mock and assertions removed; `revenue` keys lose `state`; `mockDeps.finance` 21 → 20; AC-127 asserts no `revenueExistence`.
- `financePage`, `financeAccount`, `financeSnapshot` fixtures: `state` / `countRevenueRows` removed.

### Verification (2026-10-27, worktree, uncommitted)

| Check | Result |
|---|---|
| Jest: `lib/business-os/finance app/admin/finance app/api/admin/business-os/finance app/admin/ai-cost app/admin/business-os-llm lib/repositories lib/admin lib/business-os/insight lib/business-os/credits lib/audit app/admin/components app/admin/users lib/business-os/smart-links app/api/admin/business-os/credits` | **409 suites, 12,466 tests, all passed** |
| Range-cap guard (`rangeCap.source.guard.test.ts`) | 18 / 18 passed (pins 11 / 17) |
| CPU leak guard | 227 / 227 passed, `ALLOWED` unchanged |
| `npm run test:bos-entitlements` | 314 suites, 9,389 tests passed |
| `npm run test:authz-guard` | 2 suites, 203 tests passed |
| `npm run typecheck:bos-llm` (`--max-old-space-size=8192`) | passed: 593 files in scope, 11 errors, **0 new**; baseline file untouched |
| Scoped `tsc` over the 30 touched `.ts` / `.tsx` files (8 GB) | 0 errors in touched files; 32 pre-existing errors in imported, untouched files; no OOM |
| `npm run build` | Not run locally (no env files in the worktree); CI's required Build is the proof (FU-C6) |
| `console.*` in touched files | 0 |

### Noted, not changed

- `InsightRepository.getVectorMaturity` reads `visitorsResult.count`, which was always null (the read never asked for a count), so `usedPageViews` is always false there. The paged read keeps `count: null` so behaviour is identical. Flag for the insight owner.
- `typecheck:bos-llm` reports "16 baseline entries are fixed; consider --update-baseline". The baseline was not updated (SA: it must not move).

---

### SA Code Review (SA-CR-FU)

**Code Review by SA — 2026-10-27** (uncommitted tree on `b7f02cd6`)
**Status:** ✅ Code Approved

**What I read**
- The diffs of `financeWindow.ts`, the K-1 wiring in `financeHealth.ts`, the three paged repositories, the leak-guard regex and its controls, and Pin B.
- The Implementation Notes.
- `git diff --numstat` on the two requirement docs: FIN 3 / 1, review 1 / 0. Neither is deletion-only.

**Conditions FU-C1 to FU-C7: all met**
- **FU-C1:** Pin B `a1b3db0c` → `eac3590a`, with a one-line diff (`state: 'none_yet'`). Every tile assertion is unchanged.
- **FU-C2:** the new `READS_USD` branch allows trailing braces. The nested `{ takings: { usd } }: FinancePayload` form is a must-catch. A before/after case proves that all four parameter forms passed the old matcher and are caught by the new one. The four precision controls hold, and `ALLOWED` is unchanged.
- **FU-C3:** `id` was checked on all three tables with zero-row, read-only selects. Each page repeats `.eq('user_id')`, or the caller-scoped `in('smart_link_id')`.
  - The order is total: the existing order plus `id`.
  - Paging stops on a short page or at the unchanged ceiling (5,000 / 20,000 / 5,000).
  - A page error throws or returns the error, as before, so no partial figure is presented.
  - Signatures are unchanged.
  - The audit trail's floor warning now actually fires, with counts only.
- **FU-C4:** the planted proof gives TS2344 on `ExactlyEqual` in both files, while the old `Satisfies` pair stays silent. The `@ts-expect-error` controls are in place.
- **FU-C5:** the current-mode billing pins pass unedited, and the removal `git grep` finds 0 production hits.
- **FU-C6:** no `console.*`. One commit for RM. CI's required Build check is the build proof.
- **FU-C7:** tranche A only.

**Item 2**
- `current.to` is the next UTC midnight. `previous` is unchanged, so FU-AC-3 holds.
- The read is shared only when `clamp.readFrom` and `window.end` equal `spans.current` exactly, compared as instants.
- A shared failure is logged once and makes both Section 3 and F-K3 Unknown (R-1).
- Q-R1 is pinned.
- The range-filtering fake covers the later-today and next-month rows (the MK-2 lesson).
- On the default window, AC-145 loses exactly the second ledger call.

**Pins** match the SA-WP-FU table exactly:
- AC-145 calls and hash `aebc22cb` → `38897cd3`, with the restore proof. Item 2 does not move the hash.
- Pin B: one line.
- Finance tables 9 → 8; billing-table readers 3 → 2; range-cap 14/20 → 11/17.
- AC-173, Pins A, C and D, T-12, the CPU `ALLOWED` list and the `typecheck:bos-llm` baseline are unchanged.

**Rulings**

| # | Ruling |
|---|---|
| **1. `getVectorMaturity` reads `visitorsResult.count`, which is always null** | **Yes, make it a separate follow-up, `INS-FU-1`, for the insight owner.** Keeping `count: null` was correct: this bundle's job was the paging, with identical behaviour. The issue was there before this change. Because the read never asks for a count, `usedPageViews` is always false, so vector maturity never credits page views. Fixing it changes insight output, so it needs its own requirement and tests, and possibly the golden set. Record it in FIN §0.4 or the insight backlog. Out of scope here. |
| **2. `--update-baseline` suggested for 16 fixed entries** | **Not updating is correct.** The bundle's diff must not carry an unreviewed baseline rewrite, and "baseline unchanged" was a ruled pin. A larger-than-needed baseline does leave 16 slots where an error could come back unnoticed, so ratchet it down as follow-up `BLL-FU-1`: a one-file PR after this merges, regenerated on `main` and reviewed as a shrink only (lines removed, none added). |
| **3. `financeCopy.ts` overlap with 1b** | **Accepted.** The hunks are different (`PAYING_BREAKDOWN` here, the takings copy in 1b). Whichever PR merges second takes `main` in. The merge queue tests the combined tree, and the finance render suites must be green on it. No further action. |

### Code Review Comments
None that block.

### Optimisation Suggestions
- None. Inline paging loops in three places are acceptable. A shared pager is a question for FF-3b, where 11 sites would use it.

### Code Approved for QA: Yes

---

## QA Testing Report

### QA — finance follow-ups bundle, 2026-10-27

**Test mode:** full. **Strategy used:** A + B (Jest, with independent probes on fakes that evaluate ranges and filters), plus a planted-type proof and a scoped tsc with a canary. **Focus:** all. **Skipped:** `npm run build` (FU-C6: no env files in the worktree; CI's required Build is the build proof). **Input source:** coordinator task + workplan ACs, FU-C1 to FU-C7, SA-CR-FU.

**Verdict: PASS.** No bugs. Two observations, below.

#### Test Coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| FU-AC-1 F-K3 = Section 3 = A-K1 (This month) | ✅ | Pass | Range-filtering fake ledger (rows at month start, later today 18:00 after NOW, next-day 00:00, last month). All businesses: k1 = s3 = A-K1 = 7.75: the later-today row is counted and the next-day row is not. One business: 1.75 / 1.75 / 1.75 |
| FU-AC-2 one shared read; other windows end at the next midnight | ✅ | Pass | This month: all-accounts calls = [Nov 1→Nov 10) (shared) + previous span only. 7 d: [Nov 3→Nov 10) for Section 3, [Nov 1→Nov 10) for K-1's own read, + previous span; k1 = 7.75. A failed shared read leaves Section 3 `unknown` and K-1 null |
| FU-AC-3 previous span unchanged | ✅ | Pass | `k1Spans.previous` matches the old rule (`prevStart + min(elapsed, prevMonthLength)`) at 4 instants (mid-month, 1st 00:00, Jan 31 23:59:59, Mar 31) |
| FU-AC-4 Q-R1 | ✅ | Pass | Unreadable amount: F-K3 null; Section 3 and A-K1 `partial` ("at least") |
| FU-AC-5 Paid: Unknown once, no rate line | ✅ | Pass | Exact walk with paid null: "Paid: Unknown (first payments could not be read)" appears once; `paying-breakdown-rate` absent |
| FU-AC-6 other branches unchanged | ✅ | Pass | `innerHTML` is byte-identical to main's component (extracted with `git show`, useId normalised) for 6 branches: rate shown, too few, cut off with paid known, cut off with paid unknown, trials unknown, comped unknown |
| FU-AC-7 comment-only | ✅ | Pass | `payingBreakdown.ts` diff is comment lines only |
| FU-AC-8 exact wire check + planted proof (FU-C4) | ✅ | Pass | See "Planted proof" below. `typecheck:bos-llm` (8 GB): 593 files, 11 errors, 0 new, no OOM |
| FU-AC-9 R-c / R-c′ gone | ✅ | Pass | Repository exports no billing-status reader. `git grep` hits for the two names are only the deps keys, wired to `listCurrentModeBillingStatusesAllAccounts` / `findCurrentModeBillingStatusForAccount`. `lib/admin/billing/` has no diff; `currentModeBillingStatus.test.ts` passes unedited |
| FU-AC-10 R-d gone | ✅ | Pass | 0 production hits for `countRevenueRows`, `FINANCE_BILLING_STATUS_COLUMNS`, `revenue.state` (one comment mentions `revenueExistence`). `FinanceRevenueState` removed; RevenuePanel drops `data-state` only; page render suite green |
| FU-AC-11 pins | ✅ | Pass | LF-normalised SHA-256, all byte-identical and with no diff since b7f02cd6: Pin A `a130d560` (KpiStrip.callers.pin), Pin C `e57f2675` / `64a565e9`, Pin D `1f7cf07a` (lib/admin/health m5WordingOnly.pin), AC-173 `3a1a2dd4` / `b84e0c96`, T-12 `c2891a35`. Pin B moves only as ruled (FU-C1): `a1b3db0c` → `eac3590a`, numstat `0 1`, the deleted line is `state: 'none_yet',` |
| FU-AC-12 AC-145 | ✅ | Pass | `EXPECTED_SHA256` is `38897cd3…`; `AFTER_CPU1A_SHA256` is `aebc22cb…`, which equals main's `EXPECTED_SHA256`. The restore proof (put `state: 'none_yet'` back after `status`) runs in route.test.ts and passes |
| FU-AC-13 tranche A paging | ✅ | Pass | Independent probe (see below) |
| FU-AC-14 range-cap 11/17 | ✅ | Pass | `BASELINE_ENTRIES = 11`, `BASELINE_CALL_SITES = 17`; guard green in the lib/repositories run |
| FU-AC-15 leak guard | ✅ | Pass | Forms script on the new guard: 10/10 parameter forms caught (function declaration, aliased not-last, method, nested with a trailing brace, nested plus another key, multi-line, async arrow, `Pick<>` type, object method, with default). Main's guard missed 8 of them. 7 negatives clear (no takings reach, no usd, type literal, plain `usd` parameter, `usdish`, `usdTotal`). `ALLOWED` appears in the diff only as context |
| FU-AC-16 authz | ✅ | Pass | `test:authz-guard` 2 suites / 203 tests |
| FU-AC-17 build, typecheck, Jest | ✅ (build: CI) | Pass | Verify list: 409 suites / 12,466 tests, all green. `test:bos-entitlements` 314 / 9,389. Scoped tsc over the 30 touched .ts/.tsx files (8 GB, no OOM): the canary in `financeWindow.ts` is the only error in a touched file; restored, `cmp` clean. `lint:hooks` exit 0. 0 `console.*` added |
| Finance tables 9 → 8, billing readers 3 → 2 | ✅ | Pass | finance.source.guard asserts 8 and not `business_os_billing_accounts`. Billing-reader guard: offenders = BusinessOsBillingAccountRepository + BusinessOsBillingAdminReadRepository |
| bos-llm baseline untouched | ✅ | Pass | `scripts/typecheck-bos-llm.baseline.json` has no diff (BLL-FU-1 shrink is post-merge per SA-CR-FU) |

#### Planted proof (FU-C4)

A scoped tsc ran over the two wire files only (`include: []`, both files listed); the baseline was 0 errors, and the canary was caught.

- `extra?: number` planted in `CreditReportRecordedInWindow` (creditReportTypes.ts:206):
  - `creditReport.wireTypes.test.ts(39,28)` TS2344 and `recordedInWindow.wireTypes.test.ts(40,28)` TS2344 (the ExactlyEqual lines).
  - The `Satisfies` lines are silent in both files.
- `extra?: number` planted in `CostReportPayload` (costTypes.ts:109):
  - `creditReport.wireTypes.test.ts(39,28)` TS2344 + `(40,1)` TS2578 (unused top-level `@ts-expect-error` control).
  - `Satisfies` is silent. recordedInWindow does not reference `CostReportPayload`, so it stays silent, as Dev recorded.
- Both files were restored with `cp` and checked with `cmp`.

#### Tranche A probe (independent of Dev's paging test)

The fake evaluates `eq` / `in` / `gte` / `not in` / `not like`, shuffles row order on every request so that ties have no stable order, applies `.order`, slices `.range`, and returns at most 1,000 rows per request.

**AuditTrail `countOwnerActionsSince`**
- Setup: 2,500 own rows, all with the same `created_at`, plus 800 other-user rows and 300 excluded rows (hidden entity type and AI-action prefix).
- Result: count 2,500 with 2,500 distinct entity ids. Ranges were [0,999] [1000,1999] [2000,2999].
- On every page: user, since and both BD-26 filters; order `created_at`, then `id`; no `.limit`.
- **Control:** with the `id` order dropped, the same fake gives 1,779 distinct ids. The tie-break is what prevents skipped and duplicated rows.
- 5,600 rows: 5 requests, count 5,000, and one warning `{userId, scanned: 5000, cap: 5000}` (counts only).
- Error on page 2: `data: null`, error set, 2 requests.

**SmartLink `uniqueVisitorsByLink`**
- Setup: 2,500 tied clicks on L1/L2, 1,000 on L3 (not requested) and 400 old clicks.
- Result: `{L1: 1250, L2: 1250}`.
- On every page: `.in(['L1','L2'])` + `gte clicked_at`; order `clicked_at`, then `id`.
- 21,000 clicks: 20 requests, 20,000 counted, 1 warning.
- Error on page 2: `{data: {}, error: null}`, plus an error log.

**Insight `readVisitorIdentityRows`**
- Setup: 2,500 own rows plus 600 other-user rows.
- Result: 2,500 rows, all distinct. On every page: `eq user_id` + order `id`. `count` is null.
- 5,500 rows: 5 requests, 5,000 rows.
- Error on page 2: `{data: null, error}`.

Signatures of all three methods are unchanged in the diff.

#### Issues Found

**Bugs:** none.

**Edge cases / observations (no action required for this bundle):**
1. **Q-1 (SmartLink, by design):**
   - What happens: a failed page gives `{ data: {}, error: null }`, so the figure is absent rather than an error result. That is the method's existing never-fatal contract, and the comment in the code records it.
   - Why it matters: "never a partial figure" holds. A caller cannot tell a failed read from a read with no links, but that was already true before this bundle.
2. **Q-2 (doc wording):** FU-AC-11 still says Pin B passes "unedited". The ruled FU-C1 re-freeze (one line) supersedes that, and the pin table at line 464 already says so. Optional: reword the AC.

#### Probes

All QA probe files were deleted; none were kept:
- `lib/business-os/finance/__tests__/zz_finfu_item2.test.ts`
- `app/admin/finance/__tests__/zz_finfu_item3.render.test.tsx`
- `app/admin/finance/components/zz_OldPayingBreakdownSection.tsx`
- `lib/repositories/__tests__/zz_finfu_item10.probe.test.ts`

The planted type edits and the canary were restored with `cp`, and `cmp` confirmed each restore. No source was changed and nothing was committed or stashed.

#### Final Status
- [x] All acceptance criteria pass — ready for commit (build proof: CI's required Build, per FU-C6)
- [ ] Issues found — Dev must address before commit

---

## Commit Info

*(RM to populate. One commit, one PR.)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-27 | Created (Dev) | Workplan only, no code. Seven items traced to their sources and quoted. Step 0 found three things that differ from the brief: R4-FU-1 removes no runtime read (R-d proposed instead, SA-Q-FU-3); FF-3 is about 4.5 extra days (tranche A proposed, SA-Q-FU-6); MK2-FU-1 cannot hold equal across separate loads (BQ-FU-1). Bundle estimate about 4.5 d. Awaiting SA |
| 2026-10-27 | User decisions recorded (Dev, relayed by TL) | BQ-FU-1 yes (identical = same result for data read at the same moment); BQ-FU-2 yes (remove R-d and `revenue.state`); BQ-FU-3 FF-3 tranche A only (14/20 → 11/17), FF-3b and B-1 / B-2 later. Estimate set at about 4.5 d. Still awaiting SA; no code |
| 2026-10-27 | SA workplan review (SA-WP-FU) | Approved with conditions FU-C1 to FU-C7. SA-Q-FU-1 to 10 ruled on the defaults. Pin B correction: its fixture line `state` goes with R-d (one ruled re-freeze). Item 11 regex must allow trailing braces (nested destructure). SA-WP-CPU1B B-4 superseded: the leak guard is this bundle's |
| 2026-10-27 | Built (Dev), uncommitted | All seven items per SA-WP-FU (FU-C1 to FU-C7). Pins: AC-145 calls and hash (`aebc22cb…` → `38897cd3…`, restore proof), Pin B file (`a1b3db0c…` → `eac3590a…`), finance tables 9 → 8, billing readers 3 → 2, range-cap 14/20 → 11/17. FIN §0.4 and review logs updated. Verification in Implementation Notes |
| 2026-10-27 | SA code review (SA-CR-FU) | Code approved for QA. FU-C1 to FU-C7 met; pins match the SA-WP-FU table (AC-145 hash `aebc22cb` → `38897cd3` with the restore proof; Pin B one line). Rulings: `getVectorMaturity` always-null count becomes follow-up INS-FU-1 for the insight owner; the bos-llm baseline is not updated here, and a shrink-only follow-up BLL-FU-1 comes after merge; the `financeCopy.ts` overlap with 1b is accepted (different hunks, the merge queue tests the combined tree) |
