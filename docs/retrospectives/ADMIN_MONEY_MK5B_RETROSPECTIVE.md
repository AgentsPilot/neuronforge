# Retrospective: MK-5b, Converted this month

> **Last Updated**: 2026-10-20

**MD links:** [ADMIN_MONEY_MK5B_CONVERTED_WORKPLAN.md](/docs/workplans/ADMIN_MONEY_MK5B_CONVERTED_WORKPLAN.md) | **Branch:** `feature/admin-money-mk5b-converted-this-month`, worktree `neuronforge-finance-m8`

## Overview

MK-5b adds "Converted this month: n of m paying" inside the Paying accounts tile, with a "Leading" pill, and a matching list on Plans & subscriptions. A conversion is an account's first plan payment above $0, in the current Stripe mode, in the current UTC month. Boosts and $0 payments do not count. An account that converted and then stopped paying is listed but not counted. The figures come from a new read-only repository, `BusinessOsBillingAdminReadRepository` (SA-10), plus a lineage read for the rows shown. There is no migration.

## What went well

- **The conversion rule is explicit,** and every exclusion is tested: boosts, $0 payments, the other Stripe mode and accounts that stopped paying.
- **SA-CR-MK5B approved the code.** D-2, D-3 and D-7 were approved, and one Low item was fixed (`payingRows` renamed to `planRows`). QA passed with no bugs.
- **The pins moved only as ruled.** AC-145 moved `a13f1ccd` → `23a12c7e`; every other pin is unchanged.

## What did not go well

- Dev ↔ SA back-and-forths: 1 (a Low rename). Dev ↔ QA bug fix cycles: 0. Blocked handshakes: none.
- **The read does not scale.** It pulls every past payment for every account, so the request volume grows with the number of accounts. QA estimates the figure turns permanently "Unknown" at about 1,700 paying accounts after a year.
- **Dev's recorded hash for the route-test file is stale.** The current value is `b5ca95dd`.

## Conclusions & process improvements

- **Follow-up MK5B-FU-1 (performance):** rework the read well before about 1,700 paying accounts. It is tracked in FIN §0.4.
- **Re-hash any recorded file at handover,** after the last edit.

### Status: COMMITTED — feature/admin-money-mk5b-converted-this-month — commit `4747c281`, main merged `48796149`, PR #485 (auto-merge on)

TL approval: APPROVED for RM (commit, PR, auto-merge)
