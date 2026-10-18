# Retrospective: Plan payments P-8a.2, the drawer billing panel

> **Last Updated**: 2026-10-18

## Overview

P-8a.2 adds the billing panel (AM-1) to the Businesses drawer. It shows one account's Stripe subscription, as mirrored on our billing record, next to its plan row. It flags when the two disagree and links to the customer in the Stripe dashboard. An account with no subscription reads "No Stripe subscription" (AC-F4.1). The panel uses the same MRR rule as the Subscriptions page (`lib/business-os/billing/planMrr.ts`). It is read-only and built only from our stored records: there is no live Stripe call and no migration. P-8a.1 (the MRR rule and Subscriptions page) merged as #466.

**MD links:** [BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md) | [BUSINESS_OS_PLAN_PAYMENTS_P8A_WORKPLAN.md](/docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P8A_WORKPLAN.md)

**Branch:** `feature/bos-plan-payments-p8a2`, worktree `neuronforge-finance-health`

---

## What went well

- **The drawer pins held.** The drawer's pin tests forbid any read they do not know about, so the panel loads only when "Show plan billing" is clicked (D-7). Opening the drawer still sends the same requests, and every frozen pin is unchanged.
- **Code review passed first time.** SA-CR-P8a.2 approved the code with no conditions, and D-7 to D-11 were all approved.
- **The panel and the list use the same words.** QA's Low note QA-P8a2-N1 found that the "In MRR" line did not show the past-due marker the user asked for (BQ-P8a-4). It now reads "$79 a month · past due (still counted)", exactly as on the Subscriptions page. QA passed with no bugs.

## What did not go well

- Number of Dev ↔ SA back-and-forths: 0 (code approved first time; the workplan was approved under SA-WP-P8a).
- Number of Dev ↔ QA bug fix cycles: 1 (QA-P8a2-N1, Low, wording).
- Any blocked handshake and why: none. The branch waited for #466 to merge, so the PRs were not stacked.
- **The past-due wording was not carried over from P-8a.1.** The user's BQ-P8a-4 answer was applied to the list but not, at first, to the panel.

## Conclusions & process improvements

- **When a user decision governs a label, give the label one copy constant that every surface uses,** so a second surface cannot miss it.
- **Before a drawer slice is planned, check the drawer's pin tests.** They decide whether a new read may load on open or must wait for a click.
- **Next:** P-8a.3, audit coverage (AM-7).

### Status: COMMITTED — feature/bos-plan-payments-p8a2 — commit `56afcbe3`, main merged `811f4239`, PR #467 (auto-merge on)

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-18 | Created (TL) | P-8a.2 retrospective after SA-CR-P8a.2 approved with no conditions (D-7 to D-11) and a QA pass with no bugs (QA-P8a2-N1 wording fixed); no migration, no Stripe call, pins unchanged |

TL approval: APPROVED for RM (commit, PR, auto-merge)
