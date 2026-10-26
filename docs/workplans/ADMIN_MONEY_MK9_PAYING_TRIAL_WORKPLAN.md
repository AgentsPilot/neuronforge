# Workplan: Money MK-9, paying vs comped exactness and trial-to-paid (under F-K5)

> **Last Updated**: 2026-10-25

**Developer:** Dev
**Requirement:**
- [ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md):
  - §12, row MK-9: "Remaining 5b | Paying vs comped exactness, trial-to-paid rate, under F-K5 | Full cycle | about 2 days".
  - §5b positioning (line 352): the funnel "paid" stage stays in **slice 3** and is not in MK-9.
  - Line 568: "the rest becomes MK-9".
  - Line 556 pin ruling: "AC-145 only if a payload key is added | Ruled, if so".
  - Q-11 and the §5.1 F-K5 denominator are unchanged. BD-3 still holds: six groups, comped is not paying, and a paying Founding Partner sits under its tier.
- The rules are reused from the superseded **§11N** (`feature/bos-finance-health-5b`): S5B-FR-8 to S5B-FR-16, with the BQ-22 and BQ-23 defaults the user accepted ("agree with all recommendations"), and the SA-Q113, SA-Q114, SA-Q116 and SA-Q117 recommendations.

**Branch:** `feature/admin-money-mk9-paying-trial` (worktree `neuronforge-finance-m9`, from origin/main `3a70e98a`)
**Date:** 2026-10-25
**Status:** Code Approved (SA-CR-MK9, C-1 and C-2 fixed), QA passed, TL approved; committed `c9b1fc20`, PR [#513](https://github.com/AgentsPilot/neuronforge/pull/513) opened 2026-10-26, auto-merge on. MK-10 folded in. origin/main `e0d64fb2` (MK-8 #510 merged) is in this branch: it fast-forwarded, and the four overlapping files were re-applied by hand (no stash, no stacking). SA-CR-MK9 C-1 and C-2 are fixed.
**Path:** Full cycle. No migration, **no new read** and no new repository method (SA-Q-MK9-1, option 1).

## Overview

F-K5 "Paying accounts" gets its breakdown on Plans & subscriptions. Two parts, both all businesses only:

1. **Paying vs comped, made exact** (S5B-FR-8 to S5B-FR-11, BQ-22):
   - The paying count is F-K5's own: the current-mode status, through the one `isPayingBillingRow` (BD-37).
   - The Comped group is split into **"Assigned, no subscription"** and **"Subscription ended or not paying"**. The two add up to Comped, and the six groups are unchanged (BD-3).
2. **Trial-to-paid** (S5B-FR-12 to S5B-FR-16, BQ-23):
   - The base is the trials that **ended** in the chosen window.
   - Of those, how many paid (a first plan payment at any time up to now), and of which how many paid **before** the trial ended.
   - Also shown: trials still running.
   - "Paid" is counted by the same first-payment rule as **Converted this month** (SA-Q-MK9-1, option 1).
   - A rate is shown only from **10** checkable trials up. The floor is rule data.

They are **breakdown lines under F-K5** on the Plans & subscriptions tab. There is **no new tile**: the strip stays at five, and Pin B is untouched.

**Dropped from §11N:**
- Everything MRR (S5B-W-1 to W-8, S5B-FR-1 to FR-7, AC-295 to AC-308, check 36): MK-4 built it.
- R4-FU-1 (the 5b.1 cleanup): it stays its own follow-up in FIN §0.4, and MK-9 does not do it.
- The funnel "paid" stage (§11N.8): slice 3.

---

## Step 0: code facts (origin/main `3a70e98a`, 2026-10-25)

| # | Fact | Where |
|---|---|---|
| CF-1 | **F-K5's paying set is current-mode already.** The builder takes `payingSetOf(payingResult.data)`. The rows come from R4's `listCurrentModeBillingStatusesAllAccounts` (one mode, decided in `lib/admin/billing`), each with `subscription_status` and `ended_at`. `payload.paying` is `{ scope, status, paying, accounts }` over the non-platform plan rows | `financeHealth.ts:819-840`; `financeHealthDeps.ts` (R4 wiring) |
| CF-2 | **Comped is decided in one place.** `groupFor` puts a tier basis (active, past due or grace) that is not paying into `'comped'`. `classifyAccounts` returns `groupByAccount`, so each comped account is known by id | `planGroups.ts:57-70`, `:137-140` |
| CF-3 | **"Paying" is one predicate:** `isPayingBillingRow` (status `active` or `past_due`, and not ended). The file comment still says "Mode is not filtered: test and live rows both count (BD-14)", which has been stale since R4 (SA-Q117). The finance source guard scans this file (`finance.source.guard.test.ts:102`), so the new comment must name no mode word | `lib/business-os/billing/payingSubscriptionStatuses.ts:1-30` |
| CF-4 | `planMrr.ts:28` still calls BQ-P8a-4 "still open with the user" (SA-Q117: comment only) | `lib/business-os/billing/planMrr.ts` |
| CF-5 | `financeHealth.ts:816` also says "Test and real billing rows count together (BD-14)" over the paying read, which has been stale since R4. Same comment-only fix (SA-Q-MK9-5) | `financeHealth.ts` |
| CF-6 | **A trial is recognised by its cohort:** `stateForCohort(cohort) === 'trial'`. The trial cohort id is `'trial'` (`lifecycle.ts:141`), and Finance never writes it (no literal; `planGroups.ts` uses `stateForCohort`). `deriveLifecycle` reports `trial.endsAt` only while the trial branch runs; once a tier is in force the tier wins and no trial dates are reported, but the row keeps its `cohort` (§11N CF-12) | `lib/business-os/entitlements/lifecycle.ts:64, :141, :348-405` |
| CF-7 | `planGroups.ts` is already a registered **non-gate entitlements importer** (`enforcementPoints.test.ts:530`). Trial ends computed there need no new importer | `planGroups.ts:29-36` |
| CF-8 | *(Context only since SA-Q-MK9-1: not read by MK-9.)* **The lineage first-payment stamp** is `business_os_account_lineage.first_paid_at`. It is stamped once, on the first paid plan invoice above zero, in either mode. An account with no lineage row is never stamped (§11N CF-10, MK-5b G-1 / G-2) | migrations `20261014`, `20261028` |
| CF-9 | **Three lineage reads exist.** `findHoldFactsForAccountsForAdmin` has one caller, pinned by C-7 (`paymentHoldBatch.ts`). `findSignupSourcesForAccountsForAdmin` (MK-5b) selects `account_id, source, first_paid_at`, returns the stamp as `stamped_at`, takes at most 200 UUIDs, and its one documented caller is **`financeHealthDeps.ts`** (`converted.signupSources`) | `BusinessOsAccountLineageRepository.ts:204-280`; `financeHealthDeps.ts:195` |
| CF-10 | **MK-5b already reads the first plan payment of every non-platform plan-row account, in the current mode** (`converted.firstPlanPayments` → `listFirstPlanPaymentsForAccounts`: chunks of 100, ≤ 1,000 per page, the ceiling an error), on every all-businesses Overview request. It is what **Converted this month** counts (Q-12 / BD-52: billing events, current mode) | `financeHealth.ts` (MK-5b block); `lib/admin/billing/firstPlanPayments.ts` |
| CF-11 | The page window is `[start, end)` in UTC, at most 92 days for all businesses (`ADMIN_WINDOW_MAX_DAYS`). "Since it started" is only for one business (DF-6) | `adminWindowPresets.ts:28`; `financeWindow.ts` |
| CF-12 | Plans & subscriptions renders, from the Overview payload: Plan mix (`AccountsByPlanSection`), then Converted this month (MK-5b), then Subscriptions (its own read). One fetch on load (AC-173) | `FinanceView.tsx:376-390` |
| CF-13 | **MK-8 is in flight.** PR open, branch `feature/admin-money-mk8-finance-drawers`, commit `68f22190`. It touches `PlansSubscriptions.tsx`, `subscriptionsView.ts`, `FinanceView.tsx`, `AccountsByPlanSection.tsx`, `CreditsSection.tsx` and `financeCopy.ts` | MK-8 workplan |
| CF-14 | **Numbering.** FIN ends at AC-294 and check 35 (FF-1a). §11N's AC-295 to AC-322 and checks 36 to 38 were never spliced into main (§11N is superseded) | FIN §0.1 row 5; §11N patch |

**Files MK-9 shares with MK-8:**
- `FinanceView.tsx` (Plans panel) and `financeCopy.ts`.
- Not `PlansSubscriptions.tsx`.
- `subscriptionsView.ts` is only imported by a parity test, never edited.

**Plan:** merge main after MK-8 lands, before Step 1.

---

## 1. Design

### 1.1 Paying vs comped (S5B-FR-8 to S5B-FR-11; BQ-22)

A new pure function `compedSplit` in a new file, `lib/business-os/finance/payingBreakdown.ts`. It takes:
- `groupByAccount` from `classifyAccounts`, so it uses the same accounts and the same Comped group;
- the current-mode status rows R4 already returns (CF-1), so no new read.

For each comped account:

| Has a current-mode row with a `subscription_status`? | Is it paying? | Counted as |
|---|---|---|
| No | — | **Assigned, no subscription** |
| Yes | No (ended, canceled, unpaid, incomplete, paused, trialing) | **Subscription ended or not paying** |

The two always add up to Comped. The function names no mode (the guard holds): it receives rows already narrowed.

**When the paying read failed:** Comped is folded into "Tier set" (the existing fallback). The split is `null`, shown as "Could not check", never 0.

**The note** (S5B-FR-11) is one copy constant, shown under the breakdown: "Paying means a paid plan subscription that is active or past due now. Comped means a plan in force with no paying subscription."

### 1.2 Trial-to-paid (S5B-FR-12 to S5B-FR-16; BQ-23)

**Trial set.** From the plan walk the builder already holds (no new plan read):
- the plan rows with `stateForCohort(cohort) === 'trial'`, platform accounts left out (MK-5 C-1);
- a capped walk makes the part "at least" (S5B-FR-16).

**Trial end (SA-Q114).** A new `trialEndOf(row, config, now)` **inside `planGroups.ts`**: `deriveLifecycle(fromPlanRow({ ...row, tier: null, tier_expires_at: null }), …).trial?.endsAt`.
- The copy without its tier makes the trial branch run, with pins honoured.
- No new entitlements export, and no new importer.

**Counts:**

| Count | Definition |
|---|---|
| Ended in the window | Trial end in `[window.start, window.end)` (UTC) |
| Still running | Trial end after `now` |
| Paid (of the ended) | A first plan payment at any time up to now |
| Paid before the trial ended | `firstPaymentAt < trialEnd`, both UTC instants (MK9-R1) |

**The rate.** M is every trial that ended in the window. "N of M (P%)" only when M ≥ `FINANCE_RULES.trialToPaid.minimumTrials` (**10**, rule data in `financeRules.ts` beside K-1's floor, SA-Q116). Below it: counts only, with "Too few trials for a rate".

**The source of "paid" (SA-Q-MK9-1, ruled option 1; MK9-R1).**
- It is MK-5b's **existing** current-mode first-plan-payment result (CF-10), which the builder already holds on every all-businesses Overview request.
  - That result covers every non-platform plan-row account, trials included.
  - It gives each account's earliest ever `invoice_paid` above $0 in the current mode.
- **No new read and no new dep.** There is no lineage read (SA-Q113 is moot), and `findSignupSourcesForAccountsForAdmin` stays as MK-5b uses it.
- **There is no "cannot be checked" bucket.** Billing events need no lineage row (G-2), so the rate's base is every trial that ended in the window.
- **One definition of "paid for a plan" on one page.** Trial-to-paid and Converted this month count the same payment. For the user summary (TL, as information): "trial-to-paid uses the same first-payment rule as Converted this month".

**Scope of the part:** all businesses only. With a business picked, the part is not built (one account is not a rate, S5B-FR-14).

**When the first-payment result is missing** (its read failed, or it did not run because the paying set is unknown): "Paid" and "Paid before the trial ended" are **Unknown, never 0**, and the rest renders (MK9-R1).

### 1.3 Payload: AC-145 moves once (ruled)

There is one new **optional top-level key**, `payingBreakdown`. It is set by the builder for all businesses only, and absent with a business picked. Fixtures written before MK-9 stay valid.

```ts
payingBreakdown?: {
  comped: { total: number; assignedNoSubscription: number; endedOrNotPaying: number } | null; // null: paying read failed
  trials: {
    status: 'ok' | 'partial' | 'unknown';          // partial: capped walk; unknown: the plan walk failed
    endedInWindow: number | null;
    stillRunning: number | null;
    paid: number | null;                          // null: the MK-5b first-payment result is missing (read failed or did not run)
    paidBeforeEnd: number | null;
    rate: { paid: number; base: number; percent: number } | null; // null below the floor or unknown
    minimumForRate: number;                       // the rule datum, so the page can say why
  };
};
```

- **AC-145, one ruled update** (line 556):
  - `payingBreakdown` is added to the expected keys (after `converted`);
  - `EXPECTED_CALLS` does **not** change: there is no new dep (SA ruling);
  - a new hash, with the before and after hashes recorded;
  - with `payingBreakdown` stripped, the payload gives back `23a12c7e…` (the removal proof; MK-8 adds no payload key).
- Pins A, B, C, D and AC-173 stay byte-identical.

### 1.4 Display: under F-K5 on Plans & subscriptions

A new component, `PayingBreakdownSection` ("Paying accounts", the F-K5 label). It is placed **first** on the Plans & subscriptions panel, above Plan mix, and rendered from the same Overview payload, so there is no new request (AC-173).

| Line | Content |
|---|---|
| 1 | "Paying: 9 of 50 accounts", F-K5's own figure (`payload.paying`), repeated as the head of its breakdown |
| 2 | "Comped: 6 · Assigned, no subscription 4 · Subscription ended or not paying 2", or "Could not check" |
| 3 | The S5B-FR-11 note |
| 4 | "Trials ended in this window: 12 · Paid 5 (of which before the trial ended 3) · Rate 5 of 12 (42%)", or "Too few trials for a rate" · "Still running: 7". With the first-payment result missing: "Paid: Unknown" |
| 5 | The honest-limits sentence, reworded (MK9-R1): "Paid means a first plan payment, counted as for Converted this month. Boosts are not a conversion." Plus "at least" when the plan walk was cut off. **No mode word** in any of this copy (the finance mode guard) |

- **Plan mix is not changed:** its Comped row stays one row (SA-Q-MK9-2).
- **There are no money figures**, so the `$` rule does not apply. The leading / lagging pills are not added (no KPI tile).
- **Copy:** every sentence is one constant in `financeCopy.ts`, with no mode word (guard).

### 1.5 Comment fixes (SA-Q117; comments only)

- `payingSubscriptionStatuses.ts`: the header says the predicate is mode-free and the caller narrows the rows to the current billing mode first (R4, BD-37). No mode word (the guard scans the file).
- `planMrr.ts`: BQ-P8a-4 is answered (MRR counts past due, shown apart).
- `financeHealth.ts:816`: the same correction as the first item (SA-Q-MK9-5).

---

## 2. Reads

| Read | Change |
|---|---|
| Plan walk, R4 current-mode statuses | **None**: reused for the comped split and the trial set |
| MK-5b's current-mode first plan payments (`converted.firstPlanPayments`) | **None.** The trial part reads the result the builder already holds (SA-Q-MK9-1, option 1). **No new read**, so the range-cap guard and the repository caller lists do not move (MK9-R3) |
| Finance route | Unchanged: same schema, `requireAdmin` first, and the 401, 403 and 400 paths make zero reads (as today) |

**SA-Q113 is moot** (SA ruling): no lineage read is added.

---

## 3. Files

| File | Action |
|---|---|
| `lib/business-os/finance/payingBreakdown.ts` | **New**, pure: `compedSplit`, `trialsToPaid` |
| `lib/business-os/finance/planGroups.ts` | `trialEndOf` (the SA-Q114 copy without its tier) |
| `lib/business-os/finance/financeRules.ts` | `trialToPaid.minimumTrials: 10` (rule data) |
| `lib/business-os/finance/financeTypes.ts` | `FinancePayingBreakdown`; the optional `payingBreakdown` key |
| `lib/business-os/finance/financeHealth.ts` | Builds the key (all businesses only) from the walk, the R4 rows and the MK-5b first-payment result it already holds; counts in the log line; the comment at :816. **No new dep** |
| `lib/business-os/billing/payingSubscriptionStatuses.ts`, `planMrr.ts` | Comments only |
| `app/admin/finance/components/PayingBreakdownSection.tsx` | **New** |
| `app/admin/finance/components/FinanceView.tsx` | Mounts it first on the Plans panel (**shared with MK-8**) |
| `app/admin/finance/financeCopy.ts` | Copy (**shared with MK-8**) |
| `app/api/admin/business-os/finance/route.ts` | Log line: `sections.payingBreakdown` and `counts.payingBreakdown` (counts only) |
| `scripts/check-bos-finance-paying-comped.sql`, `scripts/check-bos-finance-trials.sql` | **New** read-only checks (§5) |
| Tests | §4 |

---

## 4. Tests

**Unit: `payingBreakdown.test.ts`.**
- **Comped split (happy path):** the R4 rows' `subscription_status` and `ended_at` used as given (MK9-R4). "Assigned, no subscription" is **no current-mode row with a status**, the same predicate as MK-8's `isBilled`. A fixture over every lifecycle state and billing status: no row, active, past_due, canceled, unpaid, incomplete, paused, trialing, an ended paying row, and grace after an ended subscription. The two parts add up to Comped, and the six groups still sum to the total.
- **Grace:** a lapsed payer in grace is under "ended or not paying", never a tier group.
- **Failure:** the paying read failed, so the split is `null` (never 0).
- **Trials:**
  - fixtures on both sides of each UTC bound (start, end, now);
  - a trial that converted, before and after its end;
  - a trial whose account later took a tier (its end still found, SA-Q114);
  - a trial with pinned dates.
- **The rate:** 9 trials show no rate and the "too few" reason; 10 trials show the rate. The floor comes from `FINANCE_RULES` (a planted 5 changes it).

**Parity (S5B-FR-10).**
- For the same rows, "Assigned, no subscription" equals `buildSubscriptions`'s "No Stripe" rows **whose tier is in force**.
- The tier groups' total equals the paying current-mode rows of accounts with a tier in force.

**Builder (`financeHealth.test.ts`).**
- All businesses: the key is present, and `paid` and `paidBeforeEnd` come from the same first-payment result that Converted this month uses (one call to `converted.firstPlanPayments`, not two).
- A business picked: the key is absent.
- **Failure path:** the first-payment read fails, or does not run (paying set unknown). Then `paid` and `paidBeforeEnd` are null ("Unknown", never 0), and the comped split and the trial counts are intact.
- `paidBeforeEnd` uses `firstPaymentAt < trialEnd`: a payment exactly at the trial end is not "before".
- A capped walk gives `partial`; a failed walk gives `unknown`.

**Route (`route.test.ts`).**
- The AC-145 ruled update, with the removal proof.
- `EXPECTED_CALLS` is unchanged (no new dep).
- The log line has counts only, never an id.

**Render.**
- `PayingBreakdownSection`: every line, and the states "Could not check", "Too few trials for a rate", Unknown paid, partial and not built.
- `financePage.render.test.tsx`: the section is first on the Plans tab, and there is no new request (AC-173).

**Guards.**
- Finance livemode: `payingBreakdown.ts` and the new copy name no mode, and the pure file imports no repository, each with a planted control (MK9-R3).
- Range-cap guard and the repository caller lists: unchanged (no new read).
- The entitlements importer pins: no new importer (`test:bos-entitlements`).
- Range-cap, vocabulary, layout, contrast, authz.
- `lint:hooks`.
- The scoped tsc including the touched tests, with a canary.

---

## 5. Acceptance criteria and checks

**Numbering.** MK-9 uses its own ids, **MK9-AC-1 to MK9-AC-14** and checks **MK9-C1** and **MK9-C2**. FIN ends at AC-294 and check 35, and §11N's numbers were never spliced, so they are not reused. Mapping:

| MK-9 | From §11N | Criterion |
|---|---|---|
| MK9-AC-1 | AC-309 | Comped split in two; the parts add up; the six groups sum to the total |
| MK9-AC-2 | AC-310 | A lapsed payer in grace is "ended or not paying" |
| MK9-AC-3 | AC-311 | Parity with Subscriptions ("No Stripe", tier in force) and with the paying rows |
| MK9-AC-4 | AC-312 | A trial is recognised by `stateForCohort` only; its end is the lifecycle's, pins honoured, also after it paid |
| MK9-AC-5 | AC-313 | Ended in `[from, to)`, paid, paid before the end (`firstPaymentAt < trialEnd`) and still running are right on both sides of each bound (UTC) |
| MK9-AC-6 | AC-314 | The rate shows only at ≥ 10 trials ended in the window; the floor is data |
| MK9-AC-7 | AC-315 (rewritten, MK9-R1) | "Paid" uses MK-5b's current-mode first-payment result, the same one Converted this month uses; no new read; the result missing makes "Paid" and "Paid before" Unknown, never 0, and nothing else |
| MK9-AC-8 | AC-316 | A capped walk gives "at least"; a failed walk gives Unknown |
| MK9-AC-9 | — (S5B-FR-11 / FR-16) | The note and the honest-limits sentence are shown; "Tier set" is unchanged when paying is unknown |
| MK9-AC-10 | — (§12 placement) | The breakdown is first on Plans & subscriptions; no sixth tile; Pin B byte-identical |
| MK9-AC-11 | AC-317 | `requireAdmin` first; the finance route's reads and `EXPECTED_CALLS` are unchanged |
| MK9-AC-12 | AC-318 | No new browser request: the AC-173 pin and helper are byte-identical |
| MK9-AC-13 | AC-319 | AC-145 moves once, ruled, with the removal proof to `23a12c7e`; Pins A, B, C, D unchanged |
| MK9-AC-14 | AC-320 / AC-321 | Guards green (MK9-R3: no mode, no repository import, planted controls; no new importer); MK9-C1 and MK9-C2 run on production and agree with the page |

**Dropped from §11N:** AC-295 to AC-308 (MRR and R4-FU-1) and check 36 (MRR inputs). AC-322's manual QA becomes the QA report's manual check of the Plans tab.

**Read-only SQL checks kept:**
- **MK9-C1 (was check 37):** paying and comped per tier. It has a `livemode` p-block.
- **MK9-C2 (was check 38, rewritten by MK9-R2):** trials and their first plan payments, over all time, from **`business_os_billing_events`**: the earliest `kind = 'invoice_paid'` with `amount_minor > 0` per account, with a `livemode` p-block, as MK-5b's read does. It never uses lineage `first_paid_at`, which would disagree with the page. The page's window figures are at most these totals.

MK9-C1 is copied from §11N.11 unchanged, and MK9-C2 is rewritten as above. Both are reviewed paste-safe (ASCII only, no apostrophes in comments, never the word "into", one result set), and saved as the two script files.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| A merge with MK-8 in `FinanceView.tsx` / `financeCopy.ts` | Start Step 1 only after MK-8 lands and main is merged here |
| A trial's end differs once a tier is in force | The SA-Q114 copy without the tier, plus a test with a tier in force |
| Trial-to-paid and Converted this month disagreeing | Removed by construction: one first-payment result for both (SA-Q-MK9-1, option 1) |
| The reused read grows with the account count | Already MK5B-FU-1 (rework past 1,000 accounts); MK-9 adds no read to it |

## 7. Estimate

About **1.75 days** (MK9-R5): the pure parts and tests 0.75, the builder and route 0.25 (no lineage wiring), the UI 0.5, the checks and runs 0.25. The Step 0 merge with MK-8 comes first.

---

## 8. Open questions for SA

| # | Question | Recommendation |
|---|---|---|
| **SA-Q-MK9-1** ✅ **Ruled: option 1** | **The source of "paid".** As scoped it is the lineage stamp `first_paid_at`: mode-blind, missing without a lineage row, one new read. MK-5b (Q-12 / BD-52) already reads the first plan payment of every plan-row account **in the current mode** (CF-10) on every Overview request. Reusing it would mean **no new read at all**, "Converted this month" and trial-to-paid counting the same payment, and no "cannot be checked" (billing events need no lineage row) | **Ruled by SA: option 1.** MK-5b's read is reused; no lineage read and no "cannot be checked". No new user question: it is Q-12 / BD-52 applied consistently, and TL mentions it in the slice summary |
| SA-Q113 | Lineage read placement | **Moot** (no lineage read, SA-Q-MK9-1) |
| SA-Q114 | Trial end once a tier is in force | **The copy without its tier, inside `planGroups.ts`** (no new entitlements export or importer) |
| SA-Q116 | The minimum of 10 | **Rule data in `financeRules.ts`** |
| SA-Q117 | The comment fixes | **Yes, comments only** (two files plus CF-5) |
| **SA-Q-MK9-2** | Should the Comped row in **Plan mix** also show the two parts (S5B-FR-9 says "inside the one Comped group")? | **No, the breakdown only.** Plan mix markup and its tests stay unchanged; the breakdown sits on the same tab, directly above |
| **SA-Q-MK9-3** | Should F-K5's "Paying: 9 of 50" be repeated at the head of the breakdown? | **Yes**, the same payload value (no second computation) |
| **SA-Q-MK9-4** | The payload key: one new top-level `payingBreakdown` (one ruled AC-145 move, a clean removal proof), or nested under `paying` / `accounts.figures`? | **Top-level** |
| **SA-Q-MK9-5** | Also fix the stale BD-14 comment at `financeHealth.ts:816` (CF-5)? | **Yes**, a comment only |
| **SA-Q-MK9-6** | Full cycle or the BD-33 fast track after SA and QA? | **Full cycle** as briefed (a payload key, a read) |

---

## 9. Task List

- ✅ Step 0: merge main after MK-8 lands; re-check the code facts; record the pin hashes (A, B, C, D, AC-173, AC-145)
- ✅ Step 1: the pure `payingBreakdown.ts`, `trialEndOf`, the rule datum, with tests
- ✅ Step 2: the builder (reusing the MK-5b first-payment result; no new dep) and the route log line, with tests; the AC-145 ruled update
- ✅ Step 3: `PayingBreakdownSection` and the Plans panel, with render tests
- ✅ Step 4: the comment fixes; the two SQL checks (MK9-C2 on the billing events, MK9-R2)
- ✅ Step 5: runs (app/admin/finance, lib/business-os/finance, lib/admin/billing, lib/repositories, the route, the guards, authz, entitlements, lint:hooks, the scoped tsc with a canary, the pins, the full gate)

## Implementation Notes

**Built as approved:** SA-WP-MK9, option 1, with MK9-R1 to MK9-R5 applied.

**Step 0.** Per the coordinator, implementation started before MK-8 (#510) landed. Main is merged when #510 lands; the overlap is `FinanceView.tsx` and `financeCopy.ts`. Pin hashes on `3a70e98a`, LF:

| Pin | Hash |
|---|---|
| Pin A | `e4331716` (moved on main since MK-0a, by a later ruled slice; not by MK-9) |
| Pin B | `a1b3db0c` |
| AC-173 file and helper | `3a1a2dd4` / `b84e0c96` |
| Pin C and helper | `98ea0507` / `02813360` |
| Pin D | `1f7cf07a` |

**AC-145 is no longer `23a12c7e` on main.** The credits re-size (decision D4, `fe6941d2`) re-froze it to `5e911c70…` with no route change. That is the hash MK-9's removal proof restores.

**What was built:**
- **`lib/business-os/finance/payingBreakdown.ts`** (new, pure; no mode word, no repository import):
  - `compedSplit`: "Assigned" means no row with a status, the same "billed" rule as MK-8's `isBilled` (MK9-R4).
  - `trialsToPaid`: the half-open UTC window; "paid" from the first-payment result; "before" means `firstPaymentAt < trialEnd`; a missing result gives null (MK9-R1); the rate only from the floor up, never on a cut walk.
- **`planGroups.ts`:**
  - `isTrialRow`, through `stateForCohort` (no literal).
  - `trialEndOf` (SA-Q114): the copy of the row without its tier, through `deriveLifecycle`. No new entitlements symbol or importer.
- **`financeRules.ts`:** `FINANCE_TRIAL_TO_PAID = { minimumTrials: 10 }`.
  - **D-1:** this is a constant **beside** `FINANCE_RULES`, not inside it. `FinanceRuleSet` is `Record<FinanceTileId, rules[]>`, so a non-tile key would break the rule set's own type and validation. It is still rule data (SA-Q116).
- **`financeHealth.ts`:**
  - `payingBreakdown` is built for all businesses only, from the classifier's groups, the R4 status rows, the plan walk (platform left out) and **the same `converted.firstPlanPayments` result Converted this month uses** (one call, no new dep or read).
  - `counts.payingBreakdown` (counts only).
  - The stale comment over the paying read is fixed (SA-Q-MK9-5).
- **`financeTypes.ts`:** `FinancePayingBreakdown`, `FinanceCompedSplit`, `FinanceTrialsToPaid`, and the optional top-level `payingBreakdown` key.
- **The route:** `sections.payingBreakdown` on the log line. The query schema, the reads and `EXPECTED_CALLS` are unchanged.
- **`PayingBreakdownSection.tsx`** (new), first on the Plans & subscriptions panel, from the Overview payload:
  - "Paying" as the tile counts it (`payload.paying`), the Comped split, the note, trial-to-paid with its rate or the reason, still running, and the limits sentence.
  - Unknown is said in words, never 0. The copy (`PAYING_BREAKDOWN`) names no mode.
- **Comments only (SA-Q117):** `payingSubscriptionStatuses.ts` (no mode word, as its guard requires) and `planMrr.ts` (BQ-P8a-4 answered).
- **SQL checks:** `scripts/check-bos-finance-paying-comped.sql` (MK9-C1, check 37 unchanged) and `scripts/check-bos-finance-trials.sql` (MK9-C2 on the billing events, MK9-R2, platform left out). Both are checked paste-safe: 0 non-ASCII characters, no apostrophe in a comment, never the editor word, one result set.

**AC-145, the one ruled update:**

| | Value |
|---|---|
| Payload hash, before | `5e911c70805e03ea6cc2740a1760ee4458d8145d80769ed1e2065df39f6f9b17` (main, after the credits re-size) |
| Payload hash, after | **`333407516ae0d081d59e8372a499cf305c207adeebf931fd363b62e58f632215`** |
| Removal proof | Stripping `payingBreakdown` gives `5e911c70…`, asserted in the test as `AFTER_MK5B_SHA256` |
| Other changes | `EXPECTED_KEYS` gains `payingBreakdown` after `converted`; `EXPECTED_CALLS` is unchanged; the 200 key list gains the key |

**Tests added:**

| File | Cases |
|---|---|
| `payingBreakdown.test.ts` | 12: the split, grace, the split failure, the bounds and "before", the rate floor (9, 10, a planted 5), Paid Unknown, cut and failed walks, `isTrialRow` / `trialEndOf` (pinned, tier in force, from duration), parity with `buildSubscriptions` (No Stripe with a tier in force; the tier groups equal the paying rows), and the source guard with planted controls (MK9-R3) |
| `financeHealth.test.ts` | 5 MK-9 cases: one shared first-payment call; the read failing; no wiring; the paying read failing; a business picked |
| `payingBreakdown.render.test.tsx` | 6 |
| `financePage.render.test.tsx` | 2: first on Plans and above Plan mix, five tiles, two requests only; absent on the Overview and without the key |

**Runs (on `3a70e98a`, before the MK-8 merge):**

| Run | Result |
|---|---|
| `app/admin/finance` | 26 suites, 868 tests |
| `lib/business-os/finance` | 22 suites, 2,172 tests |
| `lib/admin/billing` and `lib/business-os/billing` | 42 suites, 3,656 tests |
| Finance route | 2 suites, 131 tests |
| Guards (vocabulary, layout, contrast, range-cap, finance source, USD copy, Finance source, enforcementPoints) | 8 suites, 2,428 tests |
| Pins A, B, AC-173, C, D | 5 suites, 101 tests; hashes unchanged |
| `test:bos-entitlements` | 306 suites, 9,225 tests |
| `lint:hooks` | Clean |
| Scoped tsc | 513 files, including the 5 touched test files, 0 errors. The canary gave TS2322, and the file was restored byte-identical |

**RC-15 fix.** The new unit test first named `BusinessOsAccountPlanRepository` for its row type, which RC-15 refuses outside the repository layer. It now takes the type from `Parameters<typeof trialEndOf>[0]`.

**Logging:** there are no `console.*` calls in any touched file.

### Merge and SA-CR-MK9 fixes (Dev, 2026-10-26)

**The merge with origin/main `e0d64fb2` (MK-8 #510).**
- The branch had no commits, so it fast-forwarded.
- Four uncommitted files overlapped: `FinanceView.tsx`, `financeCopy.ts`, `financePage.render.test.tsx` and the review doc.
  1. They were saved to scratch and reset to HEAD.
  2. The branch was fast-forwarded.
  3. MK-9's diff was re-applied with `git apply --3way`.
- `FinanceView.tsx` and the review doc applied cleanly.
- The two conflicted files are MK-9 appends only, checked against the pre-merge base. They were rebuilt as main's file plus MK-9's appended block, `\r` stripped.
- No stash, no commit, no cherry-pick.

**After the merge, the AC-145 hash is still `333407516ae0…2215`.** MK-8 added no payload key, and the removal proof `5e911c70…` holds.

**C-1 (Medium), a trial ending later today. Fixed by Dev.** `trialsToPaid` now counts a trial as still running when its end is after `now`, and **only** otherwise as ended in the window. So "ended" means `from ≤ end < min(window end, now]`, and a trial is never both. An end exactly at `now` counts as ended, not running.
- **New test:** `now` inside a preset window that ends at the next UTC midnight. One trial ends before `now` (ended), one exactly at `now` (ended), and one later today (running only).

**C-2 (Low), the SQL platform filter. Fixed by Dev.**
- `check-bos-finance-trials.sql`: the p block gains `system_admin_user_id` (null by default; set it to the server's `SYSTEM_ADMIN_USER_ID`), and the trial set leaves out both platform ids, as `isPlatformAccount` does.
- `check-bos-finance-paying-comped.sql`: its comment now says platform accounts are **counted**, as in Plan mix, whose Comped includes them.
- Both are still paste-safe: ASCII only, no apostrophe in a comment, never the editor word.

## MK-10: Finance rows open like the Businesses rows (folded into MK-9)

**Source:** user comment, 2026-10-25, verbatim: "have the open of the business line similar to the business lines, clicking on the line should open as well, and have the same button as we have there." It is recorded as a §12 row MK-10 in the review doc, folded into MK-9: same branch, same PR.
**Status:** Planning, awaiting SA's ruling on SA-Q-MK10-1. It is built **after** origin/main is merged once MK-8 (#510) has landed, because MK-8's openers are not on this branch until then. No cherry-pick and no stacking.

### MK10-1. Scope

Every Finance row that opens the MK-8 business drawer behaves like a row on the Businesses page (`app/admin/users/page.tsx`, D-17, SA Q-1). Those rows are:
- the Accounts tab rows;
- Subscriptions;
- the AI cost top accounts;
- Credits;
- Client payments.

**The D-17 rules, as on the Businesses page:**

| # | Rule |
|---|---|
| 1 | A click anywhere on the row opens the drawer |
| 2 | Except a click on a control inside the row (`ROW_CONTROL_SELECTOR`: `button, a, input, select, textarea, label, summary, [role="button"], [role="link"], [contenteditable="true"]`). The Open button is in that list, so a click on it opens once, through the button only |
| 3 | Except while text is selected inside the row (`isSelectingIn`) |
| 4 | The opener is always that row's Open button (`[data-testid="row-open"]`), never the row, so focus returns to the button on close (D-6) |
| 5 | The row gets `hover:bg-slate-700/30 transition-colors cursor-pointer`, and the open row `bg-slate-700/20` |
| 6 | No `tabIndex`, role, key handler or ARIA on the row: the Open button is the keyboard path |
| 7 | The drawer sits outside the table, so clicks inside it never bubble to a row. Finance's `BusinessDrawerProvider` already renders the drawer as a sibling of the content |

**The Open button: every difference from the Businesses rows, removed.** Comparison of MK-8 (on #510) with `users/page.tsx:685-690`:

| Aspect | Businesses (D-17, LF-8) | MK-8 today | MK-10 |
|---|---|---|---|
| Component | `OpenRowButton` | `OpenRowButton` | Same |
| Label pattern | `Open details for {name}` | `Quick look at {name}` (`BUSINESS_DRAWER.quickLook`) | **`Open details for {name}`**, with the row's own name text. The `quickLook` copy is retired |
| `testId` | `row-open` | `econ-quick-look-<id>`, `subscription-quick-look`, `ai-top-quick-look-<id>`, `credits-quick-look-<id>`, `takings-quick-look-<id>-<cur>` | **`row-open`** on every row. Rows keep their own row test ids for tests |
| Placement column | A narrow last column, `<th scope="col" className={ADMIN_TH_OPEN}><span className="sr-only">Details</span></th>`, then `<td className={ADMIN_TD_OPEN}>` | Subscriptions: the same last column. **Accounts:** inside the existing last cell, before "Open". **AI top, Credits, Client payments:** inside the business cell (`ml-2` span) | **The narrow last column on all five tables**, the Businesses markup exactly. The Accounts tab keeps its "Open" full-view link in its own cell; the button moves to the new last column |
| Row click | Yes (D-17) | No | **Yes**, D-17 rules 1 to 7 |
| Row hover, cursor and open highlight | Yes | No | **Yes** (rule 5; the open row is the drawer's current account) |
| Platform, deleted and unidentified rows | Not applicable | No opener | Unchanged: **no button and no row click** (the row has no `row-open`, so a click finds nothing and does nothing, as rule 4 implies) |
| Business picked | Not applicable | No openers | Unchanged |

**A consequence:** AI cost top accounts, Credits and Client payments each gain one narrow column (with an sr-only "Details" header). Their header-count assertions get ruled test edits. These tables carry no pins (Pin B is the tiles; AC-145 is the payload, unchanged by MK-10).

### MK10-2. SA-Q-MK10-1: a new shared export, for SA to rule on before building

**Proposal.** Promote the D-17 click logic, now private to `users/page.tsx` (`ROW_CONTROL_SELECTOR`, `isSelectingIn`, the body of `handleRowClick`), to a shared helper:

**File:** `app/admin/components/layout/rowOpenClick.ts`

```ts
/** D-17: the row's Open button to open with, or null when this click is not an "open". */
export function rowOpenTarget(event: React.MouseEvent<HTMLElement>): HTMLButtonElement | null;
```

- It returns null for:
  - a click on a control inside the row (rule 2);
  - a click while text is selected in the row (rule 3);
  - a row with no `[data-testid="row-open"]` (rule 4).
- It holds no state, makes no fetch and adds no hook, so the layout folder's rules hold (S-1, S-6; no fetch).
- **Both call sites use it:** the Businesses page (`const button = rowOpenTarget(event); if (button) openRow(user, button);`) and Finance (the same call, then `openBusiness(target, button)`). The two cannot drift.
- The constants stay exported for tests: `ROW_CONTROL_SELECTOR` and `ROW_OPEN_TEST_ID = 'row-open'`.
- A function, not a hook: nothing in it needs React state.

| Option | What it is | Cost | Verdict |
|---|---|---|---|
| **A** | The shared helper above | One new shared export | **Recommended**, as the coordinator asked |
| B | Copy the logic into Finance | Two copies, which drift | Rejected |
| C | A shared `<OpenableRow>` component | Changes the Businesses row markup, which its tests pin, more than A | Rejected |

### MK10-3. Files

| File | Action |
|---|---|
| `app/admin/components/layout/rowOpenClick.ts` | **New** (if SA-Q-MK10-1 is A), with its own unit test |
| `app/admin/users/page.tsx` | Uses the helper; behaviour unchanged (the users-page tests stay green, unedited) |
| `app/admin/finance/components/AccountEconomicsTable.tsx`, `SubscriptionsTable.tsx`, `AiCostSection.tsx`, `CreditsSection.tsx`, `TakingsSection.tsx` | The narrow Open column with `OpenRowButton` (`Open details for …`, `row-open`); the row's `onClick` through the helper; hover, cursor and open highlight |
| `app/admin/finance/components/BusinessDrawer.tsx` | `BusinessQuickLook` becomes `BusinessOpenCell` (the Businesses markup). The context also gives the open account id, for the highlight |
| `app/admin/finance/financeCopy.ts` | `BUSINESS_DRAWER.quickLook` replaced by the Businesses label pattern |
| Tests | Below |

### MK10-4. Tests

- **The helper** (`rowOpenClick.test.ts`): it returns the row's button for a plain cell click; null for a click on each control kind in the selector, and on an inner link; null while a selection is inside the row; null for a row with no `row-open`.
- **Finance render**, on each of the five tables:
  - a row click opens the drawer (one request);
  - a click on an inner control or a link (the Accounts "Open" link, the Subscriptions business link) does not;
  - a text selection does not;
  - a click on the Open button opens **once** (one request, not two);
  - focus returns to the row's Open button on close;
  - the open row carries the highlight.
- **The Open button:** `row-open`, `aria-label` "Open details for {name}", in the last column under an sr-only "Details" header.
- **AC-173:** one fetch on load, unchanged.
- **The users page:** the existing suites stay green, unedited, after it moves to the helper.
- **Guards:** layout folder, contrast, vocabulary, `lint:hooks`, and the scoped tsc with a canary.

### MK10-6. Implementation notes (Dev, 2026-10-26; SA-Q-MK10-1 option A, MK10-R1 to R5)

**Built as approved.** Every item below follows the SA ruling.

- **The shared helper, `app/admin/components/layout/rowOpenClick.ts`** (new, pure: no state, no fetch, no hook):
  - `rowOpenTarget(event)`;
  - `ROW_CONTROL_SELECTOR`, its D-17 text kept exactly;
  - `isSelectingIn`;
  - `ROW_OPEN_TEST_ID = 'row-open'`.
  - It joins the layout folder's `EXPECTED_SOURCES`, the deliberate edit the guard asks for.
- **The Businesses page** (`app/admin/users/page.tsx`): only its private `ROW_CONTROL_SELECTOR`, `isSelectingIn` and the body of `handleRowClick` are swapped for the helper. No users-page test is edited (MK10-R1).
- **Finance: `BusinessDrawer.tsx`.**
  - The provider's context now gives `{ open, openAccountId }`.
  - New `useBusinessRowOpen()` returns the Open column header, the row props (D-17 click through `rowOpenTarget`; `hover:bg-slate-700/30 transition-colors cursor-pointer`, plus `bg-slate-700/20` for the open row) and the Open cell. That cell is `OpenRowButton` with `Open details for {name}` and test id `row-open`, in `ADMIN_TD_OPEN`, under an `ADMIN_TH_OPEN` header with an sr-only "Details".
  - `businessTargetOf` says which rows are businesses.
  - The in-cell `BusinessQuickLook` and `BUSINESS_DRAWER.quickLook` are removed.
- **R2.** The business-name cell is plain text again, and the Open column button is each row's only opener.
- **R3.** The row click and the button call the same `open(target, button)`, so there is one `useDrawerResource` key and one request.
- **The five tables:**
  - Accounts: the button is in a new last column, after the "Open" full-view cell, which is kept; the deleted row gets an empty Open cell.
  - Subscriptions: its `onQuickLook` path, with the row click and an `openAccountId` highlight.
  - AI cost top accounts, Credits and Client payments: a new narrow last column each.
  - Platform, deleted and unidentified rows have no button and no row click.
  - With no drawer mounted (a business picked, or a table on its own), nothing changes.

**Every difference from the Businesses rows, removed:**

| Aspect | Was (MK-8) | Now |
|---|---|---|
| Label | "Quick look at …" | "Open details for …" |
| Test ids | Five per-table test ids | `row-open` |
| Placement | In-cell placement on four tables | The narrow last column on all five |
| Row click | None | D-17 row click |
| Row style | No hover, cursor or highlight | Hover, cursor and the open highlight |
| Row ARIA | — | None, as before |

**Ruled test edits.** In MK-8's own cases (`financeDrawers.render.test.tsx`, `financePage.render.test.tsx`), the openers are now found as `row-open` inside each row, and the header counts gain the Open column (AI top 3 → 4; Accounts +1).

**Tests added (MK10-R5):**

| File | Cases |
|---|---|
| `rowOpenClick.test.ts` | 17: a plain cell; each control kind and the inside of a link; the button itself; a selection inside; a selection elsewhere; no `row-open`; the exact selector text |
| `financePage.render.test.tsx` | 10. For AI top, Credits and Client payments, each: a row click opens with one request and the hover, pointer and highlight, with no ARIA; the button opens once; a selection does not open. Plus a platform row with no button and no open |
| `financeDrawers.render.test.tsx` | 4. Accounts: the full-view link does not open, a row click opens once, and the button opens once with the highlight and focus back on the button. Subscriptions: the business link does not open, a row click opens through the button, the button once, and a selection does not open |

**Runs after the merge, C-1, C-2 and MK-10 (2026-10-26):**

| Run | Result |
|---|---|
| `app/admin/finance` | 27 suites, 920 tests |
| `app/admin/users` | 28 suites, 673 tests; its test files unedited |
| `app/admin/components` (layout, the folder guard included) | 27 suites, 905 tests |
| `lib/business-os/finance` | 22 suites, 2,245 tests |
| `lib/admin/billing` and `lib/business-os/billing` | 42 suites, 3,664 tests |
| Finance and billing routes | 5 suites, 189 tests; AC-145 is still `333407516ae0…2215` |
| Guards (`app/admin/__tests__`, range-cap, finance source, USD copy, Finance source, enforcementPoints) | 21 suites, 2,470 tests |
| Pins A, B, AC-173, C, D | 5 suites, 103 tests; no pin file differs from HEAD |
| `test:bos-entitlements` | 307 suites, 9,243 tests |
| `lint:hooks` | Clean |
| Scoped tsc | 582 files (the users page and its tests included), 0 errors. The canary in `rowOpenClick.test.ts` gave TS2322, and the file was restored byte-identical |

### MK10-5. Acceptance criteria

| # | Criterion |
|---|---|
| MK10-AC-1 | A row click on any of the five tables opens the business drawer for that row |
| MK10-AC-2 | Rules 2, 3 and 4 hold (no open on a control or link, none while selecting, one open through the button) |
| MK10-AC-3 | The Open button is the Businesses one: the component, label, test id and last-column markup |
| MK10-AC-4 | Hover, cursor and the open highlight; no ARIA on the row |
| MK10-AC-5 | The users-page tests pass unedited; one fetch on load; pins unchanged |

**Estimate:** about 0.5 day, after the MK-8 merge and SA's ruling.

## SA Review Notes

### SA Workplan Review (SA-WP-MK9)

**Reviewed by SA, 2026-10-25, against origin/main `3a70e98a`.**
**Verdict: APPROVED WITH CONDITIONS.** Code may start after Step 0 (merge main once MK-8 has landed). Conditions MK9-R1 to MK9-R5 apply.

#### SA-Q-MK9-1: the source of "paid"

**Ruled: option 1. Reuse MK-5b's current-mode first-plan-payment read.**

Why:
- **No new read.** The builder already holds that result on every all-businesses Overview request (CF-10, `financeHealth.ts:857-863`). It covers every non-platform plan-row account, trials included, and gives each account's **earliest ever** `invoice_paid` above $0 in the current mode.
- **One definition of "paid for a plan" on one page.** Trial-to-paid and "Converted this month" then count the same payment. With option 2, the same business could be "paid" in one line and not in the other.
- **No "cannot be checked" bucket.** Billing events need no lineage row (G-2), so the rate's base is every trial that ended in the window.

**Business meaning: no new user question.** The change narrows BQ-23's stated source in one respect only: once live keys arrive, a payment made in Stripe **test** mode no longer counts as "paid". That is exactly the gap (G-1) the user **already decided** for the conversion figure on 2026-10-19: Q-12 / BD-52 count "billing events in the current Stripe mode", so a business that paid during testing still counts when it first pays for real. Applying that same user decision to trial-to-paid is consistency, not a new money rule. **TL mentions it to the user as information in the slice summary**: "trial-to-paid uses the same first-payment rule as Converted this month".

**SA-Q113 is therefore moot.** No lineage read is added, and `findSignupSourcesForAccountsForAdmin` stays as MK-5b uses it.

#### Rulings on the other questions

| # | Ruling |
|---|---|
| AC-145 | **One ruled update**, per line 556: `payingBreakdown` is added. With option 1, **`EXPECTED_CALLS` does not change** (no new dep). The removal proof is that stripping `payingBreakdown` gives `23a12c7e…` (MK-8 added no payload key). Record the before and after hashes. Pins A, B, C, D and AC-173 stay byte-identical |
| Placement | **Approved: first on Plans & subscriptions, above Plan mix.** F-K5's target is that tab (MK-5), and §3.2 places F-K5's breakdown there. A section at the top of the tab *is* "under F-K5". There is no sixth tile, so Pin B is untouched |
| SA-Q114 | **Approved.** `trialEndOf` in `planGroups.ts`, with the copy of the row without its tier through `deriveLifecycle`, so pins are honoured. `planGroups.ts` already imports `deriveLifecycle`, `fromPlanRow`, `lifecycleInputs` and `stateForCohort` (`:30-33`), so **no new entitlements symbol** is needed. If one is added anyway, update its `enforcementPoints` entry in the same change |
| SA-Q116 | **Approved.** `FINANCE_RULES.trialToPaid.minimumTrials = 10` as data, with the planted-value test |
| SA-Q117, SA-Q-MK9-5 | **Approved, comments only**, with no mode word in the scanned files |
| SA-Q-MK9-2 | **Approved: the breakdown only.** S5B-FR-9's "inside the one Comped group" is satisfied because the two parts sum to Comped. Plan mix is unchanged |
| SA-Q-MK9-3 | **Approved.** Repeat `payload.paying` as given; it is not recomputed |
| SA-Q-MK9-4 | **Approved: top-level `payingBreakdown`** (a clean removal proof) |
| SA-Q-MK9-6 | **Full cycle** (a payload key and new figures) |

#### Conditions

- **MK9-R1 (from option 1).**
  - Drop the lineage dep (`trialFirstPayments`) and "Cannot be checked": the field, the line, the note and the test.
  - The trial part reads the builder's existing MK-5b first-payment result. When that read failed, or did not run (paying set unknown), "Paid" and "Paid before the trial ended" are **Unknown**, never 0, and the rest renders.
  - "Paid before the trial ended" means `firstPaymentAt < trialEnd`, both UTC instants.
  - Re-word the S5B-FR-16 honest-limits sentence: drop "a test-mode payment marks an account paid for good" and keep "boosts are not a conversion" and the capped-walk "at least".
  - **Name no mode** in Finance copy. For example: "Paid means a first plan payment, counted as for Converted this month." If a mode word is unavoidable, it goes only through the existing allow-listed constant (MK-4 CR-1).
- **MK9-R2 (check MK9-C2).** Rewrite it on `business_os_billing_events`: the earliest `kind = 'invoice_paid'` with `amount_minor > 0` per account, with a `livemode` p-block, as MK-5b's read does. **Do not** use lineage `first_paid_at`, or the check would disagree with the page. It must stay paste-safe (ASCII, no apostrophe in a comment, never the editor word, one result set). MK9-C1 is unchanged.
- **MK9-R3 (guards).**
  - `payingBreakdown.ts` names no mode and imports no repository (a pure Finance file), with a planted control.
  - **No new read**, so the range-cap guard and the repository caller lists do not move.
  - `test:bos-entitlements` passes with no new importer.
- **MK9-R4 (comped split input).** Use the R4 rows' `subscription_status` and `ended_at` as given (already current-mode). "Assigned, no subscription" means **no current-mode row with a status**, the same predicate as MK-8's `isBilled`. That way the parity test against Subscriptions' "No Stripe" (tier in force) holds by construction.
- **MK9-R5 (estimate).** Option 1 removes the lineage wiring, so about **1.75 days**. The Step 0 merge with MK-8 comes first, because `FinanceView.tsx` and `financeCopy.ts` are shared.

#### Checked

- **Finance mode guard:** the new file and its copy must name no mode (R1, R3), and the mode stays decided in `lib/admin/billing`.
- **≤ 1,000-row cap:** no new read. The reused MK-5b read is chunked at 100 and paged at ≤ 1,000.
- **Repositories only:** yes.
- **Entitlements:** `planGroups.ts` is a registered non-gate importer, and nothing new is imported.
- **AC-173:** one fetch on load, since everything comes from the Overview payload.

### SA Code Review (SA-CR-MK9)

**Code Review by SA, 2026-10-25. Reviewed: the uncommitted tree on `feature/admin-money-mk9-paying-trial` (on main `3a70e98a`).**
**Status: Code Approved with one Medium condition, C-1, before the RM commit.** C-2 is Low.

#### Conditions R1 to R5

| # | Result |
|---|---|
| R1 | ✅ There is no lineage dep and no "cannot be checked". `trialsToPaid` takes **MK-5b's own first-payment result** (`firstRead.data`, all businesses only). When that read failed or did not run, `paid` and `paidBeforeEnd` are **null (Unknown)**, the rate is null, and the rest renders. "Paid before" is `first < end`, both UTC instants |
| R2 | ✅ `check-bos-finance-trials.sql` reads `business_os_billing_events`, the earliest `invoice_paid` with `amount_minor > 0` per account, with a `livemode` p-block. It never reads lineage `first_paid_at`. Both checks are ASCII only and never use the editor word. **See C-2** |
| R3 | ✅ `payingBreakdown.ts` is pure: one type-only import, no repository, no clock. `lib/business-os/finance/**` names no mode (SA grep). No new read, and the FF-1d range cap passes. `enforcementPoints` passes, because `trialEndOf` and `isTrialRow` use only symbols `planGroups.ts` already imports |
| R4 | ✅ `compedSplit` treats "no row, or no `subscription_status`" as **Assigned, no subscription**, the same predicate as MK-8's `isBilled`, over R4's current-mode rows. A non-paying row with a status is **ended or not paying**. The parts sum to Comped |
| R5 | ✅ Built on the merged main; the shared files are in order |

#### Rulings asked

- **AC-145 baseline: the ruling holds.** Its rule was "one ruled update, and stripping `payingBreakdown` gives **main's current** hash". Main has moved since: `fe6941d2` re-froze it to `5e911c70…`, which is `EXPECTED_SHA256` on `origin/main`. The removal proof against `5e911c70` is therefore right, and the new hash `33340751…2215` is the one ruled move. Pin A `e4331716` and the other pins: **no pin file differs from HEAD**.
- **The 10-trial floor as `FINANCE_TRIAL_TO_PAID = { minimumTrials: 10 }` in `financeRules.ts`: approved.** SA-Q116's intent was "data beside the finance rules, changeable without code". A sibling constant in the same file meets it. `FINANCE_RULES` takes only tile rule lists, and forcing a non-tile entry into it would break that type's meaning. The planted-value test must point at this constant.

#### Conditions

- **C-1 (Medium, accuracy): a trial ending later today counts as "ended".** `trialsToPaid` counts `endedInWindow` for any end in `[window.start, window.end)`. A preset window ends at the **next UTC midnight** (`windowInstants`), so a trial whose end is later today but **after `now`** counts as both "ended in this window" **and** "still running", and it lowers the rate's base and paid share. **Fix:** count a trial as ended in the window only when `from ≤ end < min(window.end, now)`. Add a test with `now` inside the window and one trial ending before `now` and one after.
- **C-2 (Low): the SQL check's platform filter.** `check-bos-finance-trials.sql` leaves out only `00000000-…` and says "the platform account is left out, as on the page". The page's `isPlatformAccount` also excludes `SYSTEM_ADMIN_USER_ID`. Either add a p-block value for that id, or reword the comment to "the all-zero platform account is left out; if `SYSTEM_ADMIN_USER_ID` has a trial row, subtract it". Make the same check in `check-bos-finance-paying-comped.sql`.

#### Tests

SA re-ran `app/admin/finance`, `lib/business-os/finance`, the finance route (AC-145), `app/admin/__tests__` (vocabulary, contrast, C-14), FF-1d and `enforcementPoints`: **4066 passed**.

#### Code Approved for QA: Yes, after C-1 (C-2 in the same commit)

### SA ruling: SA-Q-MK10-1, the shared `rowOpenTarget`

**APPROVED WITH CONDITIONS: option A.** The shared `app/admin/components/layout/rowOpenClick.ts` is right. D-17's rule ("a click on the row opens it, but never a click on a control or while selecting text") must be the same on the Businesses page and on Finance, and two copies would drift (option B). Option C would rewrite the Businesses row markup, which its tests pin. This is a **small, pure shared export** (no state, no fetch, no hook), so it fits the layout folder's rules. It still runs the full cycle as a shared export (LAY R-7), and is built after #510 merges, as planned.

**Conditions:**
- **MK10-R1 (behaviour unchanged on Businesses).** `users/page.tsx` swaps only its private body for the helper. **Every Businesses test, including the drawer pins, passes unedited.** `ROW_CONTROL_SELECTOR` keeps its exact text.
- **MK10-R2 (one opener per row, keyboard first).**
  - Each Finance row gets the shared `OpenRowButton` in the narrow Open column, matching the Businesses label pattern, as the **only** focusable opener.
  - The MK-8 business-name button becomes plain text, so a row never has two controls that do the same thing.
  - The row click is a mouse convenience only. It returns focus to the row's button on close (D-6), and the row itself gets no `tabIndex` and no `role`.
- **MK10-R3 (no double read).** A row click and the button go through the one `openBusiness`, so the drawer's `useDrawerResource` key is the same: one request per open, tested per table.
- **MK10-R4 (guards).** C-14 (the layout folder's import, fetch and console rules) passes for the new file. The contrast guard covers the new hover and open highlight. Pins A, B, C, D, AC-173 and AC-145 are unchanged, since this is markup only.
- **MK10-R5 (tests).** The helper's unit test as listed (each control kind, a selection, no `row-open`), plus one render test per Finance table: a row click opens, a click on a link or control inside does not, and the button opens once.

### SA final code review (MK-9 and MK-10 together)

**Reviewed by SA, 2026-10-26. Reviewed: the uncommitted tree on `feature/admin-money-mk9-paying-trial`, fast-forwarded to main `e0d64fb2` (MK-8 #510).**
**Final verdict: CODE APPROVED (SA-CR-MK9 final; SA-CR-MK10).** No conditions remain.

#### The MK-9 fixes

- **C-1: fixed.** In `trialsToPaid`, a trial whose end is **after `now`** is counted as still running and skipped (`continue`). Only an end at or before `now`, inside `[from, to)`, counts as ended in the window. So a trial ending later today is never counted twice, and the rate's base holds ended trials only. The test covers both sides of `now`.
- **C-2: fixed.**
  - `check-bos-finance-trials.sql` takes a `system_admin_user_id` p-block value (null by default) and leaves out both the all-zero id and that one. That matches `isPlatformAccount`.
  - The paying/comped check's comment now says platform accounts are counted there, as in Plan mix. That is correct, because that check mirrors Plan mix, not the paying %.
- **AC-145:** still `33340751…`, the one ruled move. No pin file differs from HEAD.

#### MK-10 against MK10-R1 to R5

| # | Result |
|---|---|
| R1 | ✅ `users/page.tsx` swaps only its private body for `rowOpenTarget`. `ROW_CONTROL_SELECTOR` keeps its exact text. **No file under `app/admin/users/__tests__` is modified**, the drawer pins included, and they all pass |
| R2 | ✅ Each of the five Finance tables has the shared `OpenRowButton` in a narrow last column (`ADMIN_TH_OPEN` / `ADMIN_TD_OPEN`, with an sr-only "Details" header) as the only opener. The name is plain text, and the MK-8 "Quick look" buttons are gone. The row `onClick` is a mouse extra through `rowOpenTarget`, and the row gets no `tabIndex`, role or ARIA (`BusinessDrawer.tsx:93-98`). Platform, deleted and unidentified rows get no opener |
| R3 | ✅ The row click resolves the row's own Open button, and both go through the one `openBusiness`, so one `useDrawerResource` key gives **one request per open** |
| R4 | ✅ `rowOpenClick.ts` is pure (no state, fetch, hook or console). It is added to the layout folder guard's expected-files list, a one-line ruled addition. C-14, contrast and the nav tests pass, and pins A to D and AC-173 are unchanged |
| R5 | ✅ `rowOpenClick.test.ts` covers each control kind, a text selection and a row with no `row-open`. Render tests per table cover a row click that opens, a click on an inner control that does not, and a button that opens once |

#### The MK-8 test edits

They are **only the two allowed kinds**:
- **opener lookups:** `*-quick-look-*` test ids and the "Quick look at …" label replaced by the `row-open` button and "Open details for …";
- **header counts:** each table's `columnheader` count rises by one for the Details column.

No assertion about figures, requests or drawer content was removed.

#### Runs

SA re-ran `app/admin/finance`, `app/admin/users`, `app/admin/components`, `app/admin/__tests__` (vocabulary, contrast, C-14), `lib/business-os/finance`, the finance route (AC-145) and FF-1d: **5523 passed**.

## QA Testing Report

**QA — 2026-10-26** (worktree `neuronforge-finance-m9`, branch `feature/admin-money-mk9-paying-trial` on main `e0d64fb2`, uncommitted; source stable since 00:26, before every run below). MK-9 and MK-10 together.
**Test mode:** full
**Strategy used:**
- **A + B:** every suite and guard, each run alone.
- A code read of the pure file, the builder block, the section, the shared helper, the Finance row wiring, the users-page diff and both SQL checks.
- **Two temporary, untracked QA probes, deleted afterwards** (`git status` is clean of `zz_*`; neither is kept as a permanent test, since Dev's suites already cover the same rules):
  - **(1) Pure, 10 cases:** `trialsToPaid` on both sides of every bound (window start, window end, `now`), paid and paid-before, the floor at 9 and 10, a missing first-payment result, cut and failed walks; `compedSplit` over every billing status.
  - **(2) Page level, 3 cases** through the real `FinanceView`, with **real `user-event` pointer and keyboard**: AI cost top accounts and Credits; Client payments with a second business (Beta Clinic), a text selection, and the platform row.
- The two SQL checks scanned by script.
- A scoped tsc with a canary.

**Focus:** api, ui, schema
**Skipped:** the live page and running the two SQL checks on production (user, below).
**Input source:** prompt + workplan (MK9-AC-*, MK10-AC-*)

## **Verdict: PASS. No bugs.** Three Low notes and two doc nits.

### MK-9: the "Paying accounts" breakdown

| AC | Result | Evidence |
|---|---|---|
| MK9-AC-1: Comped split in two; the parts add up; the six groups sum | ✅ | Probe 1, over every billing status: no row and a row with a null status are **Assigned, no subscription** (2); canceled, unpaid, incomplete, paused, trialing and an ended active row are **Subscription ended or not paying** (6); total 8 = 2 + 6. `classifyAccounts` and the group rule are untouched (`planGroups.ts` only gains `isTrialRow` and `trialEndOf`), so the six groups and their sum are unchanged |
| "Assigned" uses MK-8's billed-in-this-mode rule | ✅ | "Assigned" = no current-mode row with a `subscription_status`, the same predicate as MK-8's `isBilled` (the R4 rows are already one mode). Dev's parity test against `buildSubscriptions`'s "No Stripe" with a tier in force is green |
| MK9-AC-2: a lapsed payer in grace is "ended or not paying" | ✅ | Dev's test (green); probe 1's canceled and ended rows land there |
| MK9-AC-3: parity | ✅ | `payingBreakdown.test.ts` parity cases green. The split reads the **same** `payingResult.data` and the same `isPayingBillingRow` as the classifier's `payingSetOf`, so a paying account can never be Comped |
| MK9-AC-4: trial recognition and end | ✅ | `isTrialRow` goes through `stateForCohort` (no literal). `trialEndOf` takes the copy of the row without its tier through `deriveLifecycle` (pins honoured; also after a tier is in force; Dev's tests). Platform accounts are left out (`planRows` is the non-platform walk) |
| MK9-AC-5: bounds, with SA's C-1 | ✅ | Probe 1, `now` = 12:00 inside a preset window ending at the next UTC midnight. Ended: an end exactly at window start (inclusive), one just before `now`, and one **exactly at `now`**. **Running only:** one ending a millisecond after `now` (**later today**) and one at the window end. Neither: before the window, or never started. **Paid before the end** is strict: a payment exactly at the end is paid but not "before". A running trial that already paid is not counted in Paid. In a past custom window, Ended counts only that window; Still running is window-independent |
| MK9-AC-6: the rate only from 10 | ✅ | Probe 1: 9 ended trials give `rate: null`; 10 give `{ paid: 1, base: 10, percent: 10 }`. The floor is `FINANCE_TRIAL_TO_PAID.minimumTrials = 10` (data; Dev's planted-5 test). The section says "Too few trials for a rate (a rate needs at least 10)" |
| MK9-AC-7: Paid shows Unknown, never 0, when the MK-5b result failed or did not run | ✅ | Probe 1: with `firstPayments: null` and 12 ended trials, `paid` and `paidBeforeEnd` are **null**, the rate is null, and Ended and Running are intact. The builder passes `firstRead.data` (all businesses only) or null; Dev's builder tests cover a failed read, no wiring and an unknown paying set (one shared call, not two). The section renders "Paid: Unknown" |
| MK9-AC-8: a capped walk gives "at least"; a failed walk gives Unknown | ✅ | Probe 1: a capped walk gives `partial` with **no rate even above the floor**; a failed walk makes everything null with `unknown`. The section shows the "at least" notice and "No rate: not every account could be read" |
| MK9-AC-9: the note and the limits sentence | ✅ | Both are constants in `PAYING_BREAKDOWN`, rendered (Dev's render test) |
| MK9-AC-10: first on Plans & subscriptions; no sixth tile; Pin B | ✅ | Page test: first on the Plans tab, above Plan mix; five tiles; Pin B `a1b3db0c` |
| MK9-AC-11 / AC-12: route, reads and requests unchanged | ✅ | `EXPECTED_CALLS` is not among the changed lines of `route.test.ts`. AC-173 `3a1a2dd4` / `b84e0c96` are unchanged; the Plans tab still makes 2 requests (finance and subscriptions) |
| MK9-AC-13: AC-145 moves once | ✅ | `EXPECTED_SHA256` is now `333407516ae0d081…2215`. Stripping `payingBreakdown` gives `AFTER_MK5B_SHA256 = 5e911c70…9b17`, which is **main's own** `EXPECTED_SHA256` (`git show HEAD:` line 1322). The route suite passes 189/189 |
| MK9-AC-14: guards; the copy names no mode | ✅ | The finance mode guard (`finance.source.guard`) and the app finance source guard are green. A read of `PAYING_BREAKDOWN` finds no "test", "live" or mode word. `payingBreakdown.ts` has one type-only import. Range-cap (FF-1d), layout (C-14), contrast, vocabulary and `enforcementPoints` are green. `test:bos-entitlements` passes with no new importer |
| MK9-C1 / MK9-C2 paste-safe and read-only | ✅ | Script scan of both files: **0** occurrences of the editor's trouble word anywhere (in strings or out), **0** non-ASCII characters, **0** apostrophes in comments, **1** statement each, starting `with p as (` and ending in one `select`; **0** write keywords (insert, update, delete, alter, drop, create, truncate, grant, revoke). MK9-C2 reads `business_os_billing_events` (`invoice_paid`, `amount_minor > 0`, the `livemode` p-block, the earliest `paid_at`), never lineage `first_paid_at`, and leaves out the all-zero id and the optional `system_admin_user_id` (SA's C-2). **Running them on production is owed to the user** |

### MK-10: rows open like the Businesses rows

| AC | Result | Evidence |
|---|---|---|
| MK10-AC-1: a row click opens that row's business | ✅ | Probe 2 (real `user.click` on a plain cell): **AI cost top** and **Credits** rows open Acme with **one** request (`[load, load&accountId=A]`). In **Client payments**, Beta Clinic's row opens **Beta Clinic** (`…accountId=B`), not the first row's business. Dev's tests cover the **Accounts** and **Subscriptions** rows |
| MK10-AC-2: rules 2, 3 and 4 | ✅ | **Rule 3 (probe 2):** text selected inside Beta Clinic's row, then a click: no request. **Rule 4:** after a row open and Escape, a click on the Open button gives exactly **one more** request, not two. **Rule 2:** Dev's tests show the Accounts full-view link and the Subscriptions business link do not open, and `rowOpenClick.test.ts` (17 cases) covers each control kind |
| MK10-AC-3: the Open button is the Businesses one | ✅ | Probe 2: `data-testid="row-open"`, `aria-label` "Open details for Acme Dental", in the row's **last** cell. Code read: the same `OpenRowButton`, `ADMIN_TD_OPEN`, and an `ADMIN_TH_OPEN` header with an sr-only "Details", exactly as `users/page.tsx:539-540, 668-673`. No `quick-look` test id or "Quick look" copy remains in `app/admin/finance` |
| MK10-AC-4: hover, cursor, open highlight; no ARIA on the row | ✅ | Probe 2: the row has `cursor-pointer` and, while open, `bg-slate-700/20`; it has no `tabindex` and no `role`. `openableRowClass` is the users page's class string exactly |
| Platform, deleted and unidentified rows cannot be opened | ✅ | Probe 2: the Client payments **platform** row has no `row-open`, and a real click on it sends nothing. Code read: `businessTargetOf` returns null for no id, `platform` and `unknown_business`; the Accounts deleted row gets an empty Open cell and no row props |
| Focus returns to the button | ✅ | Probe 2 (real Escape): after closing, `document.activeElement` is that row's `row-open`, on AI top and Credits |
| MK10-AC-5: the Businesses page as before; one fetch; pins | ✅ | `users/page.tsx` swaps only its private body for `rowOpenTarget`: the same logic and the same `ROW_CONTROL_SELECTOR` text. `git diff --quiet HEAD` on `app/admin/users/__tests__` and `components`: **unedited**, and 28 suites, 673/673 pass. One fetch on load (probe 2: `[load]` before any click). No pin file differs from HEAD |

### Pins (LF-normalised)

| Pin | Value |
|---|---|
| AC-145 | `333407516ae0…2215` (ruled); stripped, `5e911c70…` = main |
| Pin A | `c168e2ea`, main's current value; no diff on this branch |
| Pin B | `a1b3db0c` |
| AC-173 file / helper | `3a1a2dd4` / `b84e0c96` |
| Pin C / helper | `98ea0507` / `02813360` |
| Pin D | `1f7cf07a` |

`git diff --quiet HEAD -- '*pin*' '*Pins.ts'`: no pin file differs.

### Suite runs (each alone)

| Suite | Result |
|---|---|
| `app/admin/finance` | 27/27, **920/920** |
| `app/admin/users` (test files unedited) | 28/28, **673/673** |
| `app/admin/components` (`rowOpenClick` and the layout folder guard) | 27/27, **905/905** |
| `lib/business-os/finance` | 22/22, **2245/2245** |
| `lib/admin/billing` + `lib/business-os/billing` | 42/42, **3664/3664** |
| Finance and billing routes (AC-145) | 5/5, **189/189** |
| Guards: finance mode guard, range-cap (FF-1d), layout folder (C-14), `app/admin/__tests__` (vocabulary, contrast and the rest), finance source, USD copy, `enforcementPoints` | 22/22, **2875/2875** |
| `npm run test:authz-guard` | 2/2, 203/203 |
| `npm run test:bos-entitlements` | 307/307, **9243/9243** |
| `npm run lint:hooks` | exit 0 |

All counts match Dev's.

**Scoped tsc:**
- Scope: `app/admin/finance`, `components`, `users`, the finance and billing routes, and `lib/business-os/finance`, `lib/business-os/billing` and `lib/admin/billing`. That is 582 app and lib files.
- The canary in `payingBreakdown.ts` gave `(128,7) TS2322`. The file was restored with `cp` and checked with `cmp` (identical).
- The clean run: **exit 0, 0 errors** (a real completion, not an out-of-memory exit).

### Issues Found

**Bugs:** none.

**Low (nice to fix):**
1. **"Paid: Unknown" is said twice.** With the first-payment result missing, the trial line ends "· Paid: Unknown" and the rate line also reads "Paid: Unknown" (`PayingBreakdownSection.tsx`, the rate line's `paid === null` branch). The rate line could say "Rate: Unknown" instead.
2. **Comped is not marked "at least" on a cut-off plan walk.** The Comped line prints plain counts, and the "at least" notice sits only inside the trial group, though Comped comes from the same capped walk. Plan mix itself shows the partial state.
3. **`compedSplit` comment.** It says a paying row in Comped "is not hidden", but probe 1 shows such a row falls out of **both** parts (total 1, parts 0 + 0). It cannot happen through the builder, because the split and the classifier use the same rows and the same predicate. The comment overstates it; a third bucket or a dev-only log would make it true.

**Carried from MK-8 (already recorded there, Low):** in AI top, Credits and Client payments, a business with no plan row (for example deleted since) is still openable. The drawer then shows the shared error, because the finance route answers 404.

**Doc nits:**
- §9's Task List still shows **Step 0** and **Step 5** as ⬜, though the Implementation Notes record both done.
- The QA heading was missing for a while during the parallel edits. It is back in place here.

### User browser steps (signed in as an admin)
1. **Money → Finance** → **Plans & subscriptions**. The first section is **"Paying accounts"**:
   - "Paying: N of M accounts", the same as the tile;
   - "Comped: X · Assigned, no subscription A · Subscription ended or not paying B", where A + B = X;
   - the note;
   - "Trials ended in this window: …" with Paid and "of which before the trial ended";
   - a rate only once 10 or more trials ended, otherwise "Too few trials for a rate";
   - "Still running: …".
   No line names Stripe test or live.
2. Change the window to **Last 30 days**. The trial counts change; Still running does not. The network panel shows **no** new request for the section.
3. **Overview:** in the **AI cost** top accounts, **Credits** and **Client payments** tables, click anywhere on a business row (not on a link). The drawer opens for **that** business, with one request. The row is highlighted, and every table has a narrow last column with an Open icon ("Open details for …"). Select some text in a row: nothing opens. The platform row has no icon and does nothing.
4. Press **Escape**: focus returns to that row's Open icon. Repeat on the **Accounts** tab (the "Open" link still goes to the full view and does not open the drawer) and on **Subscriptions**.
5. **Businesses** page: rows open exactly as before.
6. In the Supabase SQL editor, run `scripts/check-bos-finance-paying-comped.sql` and `scripts/check-bos-finance-trials.sql` (read-only; set the `livemode` p-block, and `system_admin_user_id` if set on the server). The totals are at least the page's window figures.

### Final Status
- [x] All MK-9 and MK-10 acceptance criteria pass. AC-145 moved once, as ruled; the other pins are unchanged; every suite passes; tsc is clean. **Ready for RM.** The Low items are optional, and the two SQL checks are owed on production by the user.
- [ ] Issues found

## Commit Info

- **Branch:** `feature/admin-money-mk9-paying-trial` (on main `e0d64fb2`, which had not moved at commit time; no merge needed)
- **Commit:** `c9b1fc20` feat(finance): paying breakdown, trial-to-paid and row open on Finance (MK-9, MK-10)
- **Pins:** AC-145 `333407516ae0d081…` (ruled); no pin file changed
- **PR:** [#513](https://github.com/AgentsPilot/neuronforge/pull/513), auto-merge on (merge commit, via the merge queue)
- **Owed by the user:** a production run of `scripts/check-bos-finance-paying-comped.sql` and `scripts/check-bos-finance-trials.sql` (informational, does not gate the merge)

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-25 | Created (Dev) | Workplan only; awaiting SA review. MRR, R4-FU-1 and the funnel stage dropped from §11N; MK-9 ids mapped; checks 37 and 38 kept as MK9-C1 and MK9-C2 |
| 2026-10-25 | SA workplan review | SA-WP-MK9: APPROVED WITH CONDITIONS. SA-Q-MK9-1 option 1 (reuse the MK-5b current-mode first-payment read; no new read; follows the user decision Q-12/BD-52, so the TL tells the user as information, with no new question); SA-Q113 moot; AC-145 one ruled update with EXPECTED_CALLS unchanged; placement first on Plans and subscriptions approved; MK9-R1 to R5; about 1.75 days |
| 2026-10-25 | SA conditions applied (Dev) | SA-WP-MK9: option 1 (reuse MK-5b's current-mode first-payment read, no lineage read, no "cannot be checked"); MK9-R1 to MK9-R5 applied; estimate 1.75 days; code after the MK-8 merge |
| 2026-10-25 | Implemented (Dev) | payingBreakdown (Comped split, trial-to-paid on the shared first-payment read), the Plans tab section, comment fixes, MK9-C1/C2; AC-145 `5e911c70` to `33340751` (ruled); other pins unchanged |
| 2026-10-25 | MK-10 folded in (Dev) | User comment 2026-10-25: Finance rows open like the Businesses rows (D-17) with the same Open button; SA-Q-MK10-1 (shared `rowOpenClick` helper) proposed; built after the MK-8 merge |
| 2026-10-25 | SA code review and MK-10 ruling | SA-CR-MK9: Code Approved with C-1 (a trial ends in the window only before now) and C-2 (the SQL platform filter, Low); R1 to R5 met; the AC-145 baseline ruling holds against main 5e911c70; the floor constant approved. SA-Q-MK10-1: option A approved with MK10-R1 to R5 |
| 2026-10-26 | Merge, C-1/C-2, MK-10 built (Dev) | origin/main e0d64fb2 (MK-8) merged by fast-forward and hand re-apply; C-1 a running trial is never also ended; C-2 the SQL platform filter; MK-10 the shared rowOpenTarget, the Businesses Open button and the D-17 row click on the five Finance tables; AC-145 still 33340751 |
| 2026-10-26 | SA final code review | CODE APPROVED (SA-CR-MK9 final, SA-CR-MK10): C-1 and C-2 fixed; MK10-R1 to R5 met; the MK-8 test edits are only the opener lookups and the header count; AC-145 33340751; pins unchanged; 5523 passed. The QA Testing Report heading, dropped by an earlier SA edit, is restored |
