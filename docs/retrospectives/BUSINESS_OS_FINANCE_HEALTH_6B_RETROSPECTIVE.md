# Retrospective: Finance slice 6b, margin after estimated Stripe fees and the KPI order

> **Last Updated**: 2026-10-17

## Overview

Slice 6b adds "Margin after Stripe fees (estimate, USD)" beside the AI margin, never in its place. It appears on the Accounts rows, the Deleted row, the platform line and the one-account summary, each with a "Stripe fees, estimate" line and an always-on note. No fee is recorded for plan or boost payments, so the fee is estimated per successful charge at 2.9% + USD 0.30 (the BQ-15 default, still open with the user). The rate is held as data in `financeRules.ts` and injected into the pure 6a builder. 6b also re-orders the KPI tiles to revenue, then cost, then users: K-5, K-1, K-3, K-2, K-4 (BD-35). There is no migration, no new read and no write. It ran under the BD-33 fast track: SA, QA and TL approve, then RM commits, opens the PR and turns on auto-merge.

**MD links:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md §11K](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) | [BUSINESS_OS_FINANCE_HEALTH_SLICE_6B_STRIPE_FEE_MARGIN_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_6B_STRIPE_FEE_MARGIN_WORKPLAN.md)

**Branch:** `feature/bos-finance-health-6b` (from main `e43dcb60`, after M-8 #448), worktree `neuronforge-finance-m8`

---

## What went well

- **The workplan read the guards before the code.** VL-3 to VL-6 found that FE-8's literal "fee × MINOR_TO_COST_UNITS" would break the 6a scale pin, and that a `STRIPE_` name would trip the case-insensitive `stripe_` scan. One shared `marginUnitsOf` helper and careful naming meant that no existing guard line was edited.
- **The AI margin did not move.** The after-fees figure uses the exact identity (r − f)·k − c = (r·k − c) − f·k, so the 6a margin tests and the AC-145 baseline hash passed unedited.
- **The fee maths was checked three times.** Dev ran it in Node, SA re-derived it and QA probed the real builders: 7900 → 259, 1000 → 59, owner October 318¢, half-up at 500 → 45. The exact modulo division matches Postgres truncation in checks 27 and 28.
- **The re-order was proven to be a pure move.** A sorted-line diff of `FinanceKpiStrip.tsx` showed only added comments. Pin B does not read order, so all seven frozen pins stayed byte-identical with no re-freeze.
- **Dev raised the zero-total boost edge (6b-4) before building.** SA ruled it no charge (E-72), and the checks were aligned with the code.
- **The deviations were small and recorded.** D-1 to D-6 were each written up with a reason, and SA accepted all six with no conditions.
- **QA's independent probe** (11 cases on the real builders, then deleted) covered config faults, refunds and disputes keeping their fee, non-USD lines and sort stability.

## What did not go well

- Number of Dev ↔ SA back-and-forths: 1. SA approved the workplan with conditions 6B-R1 to 6B-R3 (all Low) and requirement edits E-72 to E-74. The code review passed first time with no conditions.
- Number of Dev ↔ QA bug fix cycles: 0. QA passed with no bugs.
- Any blocked handshake and why: none.
- **ts-jest did not catch the missing new fields in old fixtures.** They showed up only as 5 + 22 runtime failures. The scoped `tsc` with a canary (V-8) was the only type evidence.
- **The workplan planned an order-test view that does not exist.** The Accounts tab with a business picked is refused by the route (SA-W84), so D-5 dropped it.
- **The Step 0 baseline Jest run was skipped.** The first failures were all expected exact-shape cases, but a clean baseline would have shown that directly.

## Conclusions & process improvements

- **When a requirement formula meets a textual pin, make the workplan restate the formula as an exact identity.** Then the pin and the formula both hold, as E-74 did.
- **Keep the scoped `tsc` with a canary on every slice that adds a required payload field.** ts-jest does not type-check fixtures here.
- **Check each planned view against the route's refusals before listing it in a test plan.**
- **Run the Step 0 baseline suite even when the tree is untouched.**
- **Still owed to the user:** BQ-15 (the real fee rate; changing it is a one-line data edit), and the live steps L-142 to L-147 with checks 27 and 28 (owner October `usd_fee_minor` should be 318). These are AC-256 and the live halves of AC-246, AC-249 and AC-250.
- **Landing with 4b.2:** whoever lands second rebases, and the fee stays on the charge list. The 6b-11 tripwire test enforces this.

### Status: APPROVED FOR COMMIT — feature/bos-finance-health-6b — commit pending (RM)

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-17 | Created (TL) | 6b retrospective after SA workplan approval (6B-R1 to 6B-R3), SA code approval with no conditions (D-1 to D-6 accepted) and a QA pass with no bugs (AC-243 to AC-255); fast track BD-33, no migration, auto-merge allowed |

TL approval: APPROVED for RM (commit, PR, auto-merge)
